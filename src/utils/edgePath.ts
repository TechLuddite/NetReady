import type {
  EdgeClientView,
  EdgePathResult,
  EdgePop,
  EdgeProbeResult,
  EdgeTarget,
  MeasurementFailure,
  PhaseTimings,
  ProtocolEvidence,
  TimingAvailability,
} from '../types';
import { createId } from './network';
import { lookupIata } from '../data/iata';
import { calculateGreatCircleDistanceKm } from './tracert';

/**
 * Edge Path Explorer.
 *
 * The traceroute this replaces invented every intermediate hop, because a
 * browser cannot send ICMP or set an IP TTL. Rather than simulate what is
 * unobservable, this measures what actually is:
 *
 *   1. The DNS → TCP → TLS → TTFB breakdown of a real connection, from the
 *      Resource Timing API.
 *   2. Which CDN edge answered, by IATA code, resolved to a real coordinate.
 *   3. The protocol negotiated (h3 / h2 / http/1.1), which reveals whether
 *      UDP/443 is being blocked somewhere upstream.
 *   4. An upper bound on how far away a server can be, from round-trip time
 *      and the speed of light in fibre.
 *
 * Every one of these has a real failure mode, and each is reported rather than
 * papered over.
 */

/** Speed of light in optical fibre, ~2/3 c, in km per millisecond. */
const FIBRE_KM_PER_MS = 200;

/**
 * Upper bound on one-way distance implied by a round trip.
 *
 * Signal cannot travel faster than this, so the true distance is at most
 * `rtt / 2 * 200` km. Queuing, serialisation and server processing only add
 * time, which loosens the bound — it never breaks it. That makes this a
 * genuine constraint rather than an estimate: the server is *somewhere inside*
 * this radius.
 */
export function rttToMaxDistanceKm(roundTripMs: number): number {
  return Math.round((roundTripMs / 2) * FIBRE_KM_PER_MS);
}

/**
 * Origins probed for phase timings.
 *
 * Cross-origin phase data requires `Timing-Allow-Origin`. These are chosen
 * because they serve it, but `expectsTao` never influences what gets reported —
 * availability is determined from the entry itself at runtime.
 */
export const EDGE_TARGETS: EdgeTarget[] = [
  {
    label: 'Cloudflare',
    origin: 'https://speed.cloudflare.com',
    probeUrl: 'https://speed.cloudflare.com/__down?bytes=1000',
    expectsTao: true,
  },
  {
    label: 'jsDelivr',
    origin: 'https://cdn.jsdelivr.net',
    probeUrl: 'https://cdn.jsdelivr.net/npm/tiny-inflate@1.0.3/package.json',
    expectsTao: true,
  },
  {
    label: 'cdnjs',
    origin: 'https://cdnjs.cloudflare.com',
    probeUrl: 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.slim.min.js',
    expectsTao: true,
  },
  {
    label: 'unpkg',
    origin: 'https://unpkg.com',
    probeUrl: 'https://unpkg.com/tiny-inflate@1.0.3/package.json',
    expectsTao: true,
  },
];

const EMPTY_PHASES: PhaseTimings = {
  dnsMs: null,
  tcpMs: null,
  tlsMs: null,
  ttfbMs: null,
  transferMs: null,
  totalMs: null,
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Classifies a Resource Timing entry and extracts phases.
 *
 * Two failure modes must be distinguished from a genuine zero:
 *
 * - **TAO missing.** For a cross-origin response without `Timing-Allow-Origin`,
 *   the spec zeroes `domainLookupStart/End`, `connectStart/End`,
 *   `secureConnectionStart`, `requestStart` and `responseStart`, and returns an
 *   empty `nextHopProtocol`. Rendering those as "0 ms DNS" would be exactly the
 *   class of fabrication this project exists to remove.
 *
 * - **Connection reuse.** DNS, TCP and TLS only occur on the first connection
 *   to an origin. On a reused connection the spec collapses those timestamps
 *   onto `fetchStart`, so there is no handshake to report — not a zero-cost one.
 */
export function readPhases(entry: PerformanceResourceTiming): {
  availability: TimingAvailability;
  phases: PhaseTimings;
  protocol: string | null;
} {
  // TAO gate: responseStart is zeroed while duration is real.
  if (entry.responseStart === 0 && entry.duration > 0) {
    return {
      availability: 'timing-allow-origin-missing',
      phases: { ...EMPTY_PHASES, totalMs: round1(entry.duration) },
      protocol: null,
    };
  }

  const protocol = entry.nextHopProtocol ? entry.nextHopProtocol : null;

  const dns = entry.domainLookupEnd - entry.domainLookupStart;
  const connect = entry.connectEnd - entry.connectStart;
  const handshakeObserved = connect > 0 || dns > 0;

  if (!handshakeObserved) {
    return {
      availability: 'connection-reused',
      phases: {
        ...EMPTY_PHASES,
        ttfbMs: round1(entry.responseStart - entry.requestStart),
        transferMs: round1(entry.responseEnd - entry.responseStart),
        totalMs: round1(entry.duration),
      },
      protocol,
    };
  }

  // secureConnectionStart is 0 for plaintext, and for browsers that omit it.
  const tls =
    entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : null;

  return {
    availability: 'available',
    phases: {
      dnsMs: round1(dns),
      // TCP proper excludes the TLS portion of the connect window.
      tcpMs: round1(tls === null ? connect : Math.max(0, connect - tls)),
      tlsMs: tls === null ? null : round1(tls),
      ttfbMs: round1(entry.responseStart - entry.requestStart),
      transferMs: round1(entry.responseEnd - entry.responseStart),
      totalMs: round1(entry.duration),
    },
    protocol,
  };
}

/** Probes one origin and reads back its Resource Timing entry. */
async function probeTarget(target: EdgeTarget, signal?: AbortSignal): Promise<EdgeProbeResult> {
  // Unique URL so the entry is unambiguous and no cache is consulted.
  const url = `${target.probeUrl}${target.probeUrl.includes('?') ? '&' : '?'}_nr=${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const started = performance.now();
  try {
    const res = await fetch(url, { cache: 'no-store', mode: 'cors', signal });
    // Drain so responseEnd reflects the full transfer.
    await res.arrayBuffer();
  } catch (e) {
    return {
      target,
      availability: 'request-failed',
      phases: EMPTY_PHASES,
      protocol: null,
      roundTripMs: null,
      maxDistanceKm: null,
      error: e instanceof Error ? e.message : 'Request failed',
    };
  }

  const roundTripMs = round1(performance.now() - started);

  const entry = performance
    .getEntriesByType('resource')
    .filter((e): e is PerformanceResourceTiming => e.name === url)
    .pop();

  if (!entry) {
    return {
      target,
      availability: 'request-failed',
      phases: { ...EMPTY_PHASES, totalMs: roundTripMs },
      protocol: null,
      roundTripMs,
      maxDistanceKm: rttToMaxDistanceKm(roundTripMs),
      error: 'The browser recorded no timing entry for this request.',
    };
  }

  const { availability, phases, protocol } = readPhases(entry);

  // Prefer TTFB over wall-clock for the distance bound: it excludes content
  // transfer, so it is closer to a true round trip.
  const rttForDistance = phases.ttfbMs ?? roundTripMs;

  return {
    target,
    availability,
    phases,
    protocol,
    roundTripMs,
    maxDistanceKm: rttToMaxDistanceKm(rttForDistance),
  };
}

/** Parses the `k=v` body of a Cloudflare `/cdn-cgi/trace` endpoint. */
export function parseCfTrace(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

/** Builds an EdgePop from an IATA colo code, resolving it against the table. */
export function popFromColo(colo: string | null, httpProtocol: string | null): EdgePop | null {
  if (!colo) return null;
  const loc = lookupIata(colo);
  return {
    colo: colo.toUpperCase(),
    city: loc?.city ?? null,
    country: loc?.country ?? null,
    lat: loc?.lat ?? null,
    lng: loc?.lng ?? null,
    unmappedCode: loc === null,
    httpProtocol,
  };
}

/**
 * Queries `speed.cloudflare.com/meta`, which is CORS-enabled and returns both
 * the edge that served the request and the client identity as that edge sees
 * it. One request replaces the three separate GeoIP providers the old
 * traceroute engine relied on — and unlike them, the answer comes from the
 * network element actually handling the traffic.
 */
export async function fetchCloudflareMeta(
  signal?: AbortSignal,
): Promise<{ pop: EdgePop | null; client: EdgeClientView | null }> {
  const res = await fetch(`https://speed.cloudflare.com/meta?_nr=${Date.now()}`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(`Cloudflare meta returned ${res.status}`);
  const d = await res.json();

  const lat = parseFloat(d.latitude);
  const lng = parseFloat(d.longitude);

  return {
    pop: popFromColo(d.colo ?? null, d.httpProtocol ?? null),
    client: {
      ip: d.clientIp ?? null,
      asn: typeof d.asn === 'number' ? d.asn : null,
      asOrganization: d.asOrganization ?? null,
      city: d.city ?? null,
      country: d.country ?? null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    },
  };
}

/**
 * Asks a specific host which edge serves it, via `/cdn-cgi/trace`.
 *
 * Only works for Cloudflare-fronted hosts that allow the cross-origin read, so
 * failure is the common case and is reported as such rather than guessed at.
 */
export async function fetchTargetPop(host: string, signal?: AbortSignal): Promise<EdgePop> {
  const clean = host
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const res = await fetch(`https://${clean}/cdn-cgi/trace?_nr=${Date.now()}`, {
    cache: 'no-store',
    mode: 'cors',
    signal,
  });
  if (!res.ok) throw new Error(`${clean} returned ${res.status} for /cdn-cgi/trace`);

  const trace = parseCfTrace(await res.text());
  const pop = popFromColo(trace.colo ?? null, trace.http ?? null);
  if (!pop) throw new Error(`${clean} did not report an edge location`);
  return pop;
}

/**
 * Turns observed protocols into a verdict about UDP/443.
 *
 * All four probe origins advertise HTTP/3. If every one of them negotiated
 * HTTP/2 instead, the browser tried QUIC and fell back — which is real evidence
 * that UDP/443 is blocked upstream, not a guess.
 */
export function assessProtocols(probes: EdgeProbeResult[]): ProtocolEvidence {
  const protocols = probes.map((p) => p.protocol).filter((p): p is string => Boolean(p));

  const h3Count = protocols.filter((p) => p.startsWith('h3')).length;
  const h2Count = protocols.filter((p) => p === 'h2').length;
  const http1Count = protocols.filter((p) => p.startsWith('http/1')).length;
  const negotiated = Array.from(new Set(protocols));

  if (protocols.length === 0) {
    return {
      negotiated,
      h3Count,
      h2Count,
      http1Count,
      verdict: null,
      explanation:
        'No origin returned a readable protocol. Cross-origin protocol data requires a ' +
        'Timing-Allow-Origin header, so this is unavailable rather than negative.',
    };
  }

  if (h3Count > 0) {
    return {
      negotiated,
      h3Count,
      h2Count,
      http1Count,
      verdict: 'http3-working',
      explanation:
        `HTTP/3 negotiated with ${h3Count} of ${protocols.length} origins, so QUIC over ` +
        'UDP/443 is reaching the network. This usually means lower latency on lossy links.',
    };
  }

  if (http1Count === protocols.length) {
    return {
      negotiated,
      h3Count,
      h2Count,
      http1Count,
      verdict: 'legacy-http1',
      explanation:
        'Every connection fell back to HTTP/1.1. A proxy or TLS-inspecting middlebox is the ' +
        'usual cause, and it costs both throughput and latency.',
    };
  }

  return {
    negotiated,
    h3Count,
    h2Count,
    http1Count,
    verdict: 'http3-absent-udp-possibly-blocked',
    explanation:
      `All ${protocols.length} origins negotiated HTTP/2 despite advertising HTTP/3. The ` +
      'browser attempted QUIC and fell back, which points to UDP/443 being blocked by a ' +
      'firewall or middlebox on this network. Connections still work; they just lose the ' +
      'faster path.',
  };
}

/**
 * Runs the full exploration.
 *
 * `targetHost` is optional: without it the tool still reports the client's own
 * edge, phase timings and protocol evidence.
 */
export async function exploreEdgePath(
  targetHost?: string,
  onProgress?: (stage: string) => void,
  signal?: AbortSignal,
): Promise<EdgePathResult> {
  const startedAt = performance.now();
  const failures: MeasurementFailure[] = [];

  if (!navigator.onLine) {
    return {
      id: createId('edgepath'),
      timestamp: Date.now(),
      targetHost: targetHost?.trim() || null,
      targetPop: null,
      referencePop: null,
      client: null,
      probes: [],
      protocolEvidence: assessProtocols([]),
      clientToPopKm: null,
      totalTimeMs: 0,
      failures: [
        {
          metric: 'all',
          reason: 'network-offline',
          detail: 'The browser reports no network connection, so nothing was measured.',
        },
      ],
    };
  }

  // 1. Which edge serves us, and how does it see us.
  onProgress?.('Identifying the edge serving your connection');
  let referencePop: EdgePop | null = null;
  let client: EdgeClientView | null = null;
  try {
    const meta = await fetchCloudflareMeta(signal);
    referencePop = meta.pop;
    client = meta.client;
  } catch (e) {
    failures.push({
      metric: 'referencePop',
      reason: 'api-unreachable',
      detail: `Could not reach speed.cloudflare.com/meta: ${
        e instanceof Error ? e.message : 'request failed'
      }. Your edge location and client ASN are unknown.`,
    });
  }

  // 2. Phase timings across several origins.
  onProgress?.('Measuring connection phases');
  const probes: EdgeProbeResult[] = [];
  for (const target of EDGE_TARGETS) {
    if (signal?.aborted) break;
    probes.push(await probeTarget(target, signal));
  }

  const taoBlocked = probes.filter((p) => p.availability === 'timing-allow-origin-missing');
  if (taoBlocked.length === probes.length && probes.length > 0) {
    failures.push({
      metric: 'phases',
      reason: 'unsupported-api',
      detail:
        'No origin returned phase timings. Cross-origin DNS, TCP and TLS timings require a ' +
        'Timing-Allow-Origin header, which none of the probed origins supplied on this network.',
    });
  }

  const reused = probes.filter((p) => p.availability === 'connection-reused');
  if (reused.length > 0) {
    failures.push({
      metric: 'handshake',
      reason: 'insufficient-samples',
      detail:
        `${reused.length} origin(s) answered over an already-open connection, so there was no ` +
        'handshake to measure. Reload the page to force fresh connections.',
    });
  }

  // 3. Which edge serves the requested host.
  let targetPop: EdgePop | null = null;
  const cleanTarget = targetHost?.trim() || null;
  if (cleanTarget) {
    onProgress?.(`Asking ${cleanTarget} which edge serves it`);
    try {
      targetPop = await fetchTargetPop(cleanTarget, signal);
    } catch (e) {
      failures.push({
        metric: 'targetPop',
        reason: 'cors-blocked',
        detail:
          `${cleanTarget} did not return an edge location. Only Cloudflare-fronted hosts expose ` +
          `/cdn-cgi/trace to a browser, so this is expected for most sites. (${
            e instanceof Error ? e.message : 'request failed'
          })`,
      });
    }
  }

  // 4. Distance between the client and the edge that served it.
  let clientToPopKm: number | null = null;
  if (
    client?.lat != null &&
    client?.lng != null &&
    referencePop?.lat != null &&
    referencePop?.lng != null
  ) {
    clientToPopKm = calculateGreatCircleDistanceKm(
      client.lat,
      client.lng,
      referencePop.lat,
      referencePop.lng,
    );
  }

  return {
    id: createId('edgepath'),
    timestamp: Date.now(),
    targetHost: cleanTarget,
    targetPop,
    referencePop,
    client,
    probes,
    protocolEvidence: assessProtocols(probes),
    clientToPopKm,
    totalTimeMs: Math.round(performance.now() - startedAt),
    failures,
  };
}
