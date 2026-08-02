import type {
  AddressFamily,
  DualStackResult,
  FamilyProbe,
  MeasurementFailure,
} from '../types';
import { createId } from './network';

/**
 * Dual-stack (IPv4 / IPv6) reachability.
 *
 * A page cannot ask the browser which address families it has, which one a
 * given connection used, or what the machine's own addresses are. Everything
 * here is therefore an observation rather than an inference:
 *
 *   1. Connect to hostnames that publish *only* an A record, and to hostnames
 *      that publish *only* an AAAA record. A response proves that family works
 *      end to end. No response proves nothing on its own, and is reported as
 *      "no response", never as "IPv6 is disabled".
 *
 *   2. Ask a dual-stack host which address it saw. The family of that address
 *      is the family the browser actually chose — Happy Eyeballs preference,
 *      observed rather than assumed.
 *
 * Two independent providers are probed per family so that one provider having a
 * bad day does not turn into a verdict about the user's network.
 */

/** Per-probe timeout. Long enough for a slow first connection, short enough
 *  that a fully blocked family does not stall the whole check. */
const PROBE_TIMEOUT_MS = 6000;

export interface FamilyEndpoint {
  family: AddressFamily;
  host: string;
  url: string;
}

/**
 * Family-pinned endpoints.
 *
 * Each host publishes records for one family only, which is the entire point:
 * `ipv6.icanhazip.com` has no A record, so a browser with no working IPv6 path
 * cannot reach it by any route. Both providers return the caller's address as
 * plain text, so a successful probe also yields the address the far end saw.
 */
export const FAMILY_ENDPOINTS: FamilyEndpoint[] = [
  { family: 'ipv4', host: 'ipv4.icanhazip.com', url: 'https://ipv4.icanhazip.com/' },
  { family: 'ipv4', host: 'api4.ipify.org', url: 'https://api4.ipify.org/' },
  { family: 'ipv6', host: 'ipv6.icanhazip.com', url: 'https://ipv6.icanhazip.com/' },
  { family: 'ipv6', host: 'api6.ipify.org', url: 'https://api6.ipify.org/' },
];

/** Dual-stack host used to observe which family the browser prefers. Already
 *  contacted by the speed test, so this adds no new third party. */
const PREFERENCE_URL = 'https://speed.cloudflare.com/meta';

/**
 * Which family an address literal belongs to.
 *
 * Deliberately strict: anything that is not clearly one or the other returns
 * null, so a malformed or truncated response cannot be counted as evidence of
 * either family.
 */
export function familyOfIp(raw: string | null | undefined): AddressFamily | null {
  if (!raw) return null;
  const ip = raw.trim();
  if (ip.length === 0) return null;

  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is an IPv6 literal carrying a v4 address.
  // The connection that produced it was IPv6, so it is classified as such.
  if (ip.includes(':')) {
    return /^[0-9a-fA-F:]+(:\d{1,3}(\.\d{1,3}){3})?$/.test(ip) ? 'ipv6' : null;
  }

  const octets = ip.split('.');
  if (octets.length !== 4) return null;
  const valid = octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255);
  return valid ? 'ipv4' : null;
}

/** AbortSignal that fires on timeout or when the caller aborts. */
function timeoutSignal(ms: number, external?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  external?.addEventListener('abort', onAbort);
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Probes one family-pinned endpoint.
 *
 * A CORS read is attempted first because the body carries the observed address.
 * If that fails, the request is repeated in `no-cors` mode, which still proves
 * the connection completed even though the response is opaque. Falling back
 * matters: a missing `Access-Control-Allow-Origin` header is a property of the
 * provider, and reporting it as "IPv6 unreachable" would be a wrong answer
 * derived from a working connection.
 */
export async function probeFamilyEndpoint(
  endpoint: FamilyEndpoint,
  signal?: AbortSignal,
): Promise<FamilyProbe> {
  const url = `${endpoint.url}${endpoint.url.includes('?') ? '&' : '?'}_nr=${Date.now()}`;
  const started = performance.now();

  const gate = timeoutSignal(PROBE_TIMEOUT_MS, signal);
  try {
    const res = await fetch(url, { cache: 'no-store', mode: 'cors', signal: gate.signal });
    const body = (await res.text()).trim();
    // Only accept a body that actually parses as an address. Anything else is
    // reported as an answer with no readable address rather than being stored
    // as though the provider had returned something meaningful.
    const observedIp = familyOfIp(body) === endpoint.family ? body : null;
    return {
      family: endpoint.family,
      host: endpoint.host,
      url: endpoint.url,
      outcome: 'answered',
      roundTripMs: Math.round(performance.now() - started),
      observedIp,
      error: null,
    };
  } catch (corsError) {
    // Second attempt: reachability only. An opaque response still tells us the
    // connection completed, which is the thing this check is actually about.
    const opaqueGate = timeoutSignal(PROBE_TIMEOUT_MS, signal);
    try {
      await fetch(url, {
        method: 'HEAD',
        cache: 'no-store',
        mode: 'no-cors',
        signal: opaqueGate.signal,
      });
      return {
        family: endpoint.family,
        host: endpoint.host,
        url: endpoint.url,
        outcome: 'answered',
        roundTripMs: Math.round(performance.now() - started),
        observedIp: null,
        error:
          `${endpoint.host} answered, but did not allow this page to read the response, ` +
          'so the address it saw is unknown.',
      };
    } catch {
      return {
        family: endpoint.family,
        host: endpoint.host,
        url: endpoint.url,
        outcome: 'no-response',
        roundTripMs: null,
        observedIp: null,
        error: corsError instanceof Error ? corsError.message : 'Request failed',
      };
    } finally {
      opaqueGate.done();
    }
  } finally {
    gate.done();
  }
}

const label = (family: AddressFamily): string => (family === 'ipv6' ? 'IPv6' : 'IPv4');

export interface DualStackClassification {
  ipv4Reachable: boolean | null;
  ipv6Reachable: boolean | null;
  verdict: DualStackResult['verdict'];
  explanation: string;
}

/**
 * Turns probe outcomes into a verdict.
 *
 * Pure, so the wording of every branch is testable without a network. Note that
 * a family with no probes at all yields null, not false: a check that did not
 * run has not failed.
 */
export function classifyDualStack(
  probes: readonly FamilyProbe[],
  preferredFamily: AddressFamily | null,
): DualStackClassification {
  const of = (family: AddressFamily) => probes.filter((p) => p.family === family);
  const reach = (family: AddressFamily): boolean | null => {
    const list = of(family);
    if (list.length === 0) return null;
    return list.some((p) => p.outcome === 'answered');
  };

  const ipv4Reachable = reach('ipv4');
  const ipv6Reachable = reach('ipv6');

  if (ipv4Reachable === null || ipv6Reachable === null) {
    return {
      ipv4Reachable,
      ipv6Reachable,
      verdict: null,
      explanation:
        'Not enough of the check ran to say anything about address families. ' +
        'At least one endpoint in each family has to be tried.',
    };
  }

  const preference = preferredFamily
    ? ` The browser reached a dual-stack host over ${label(preferredFamily)}, so that is the ` +
      'family it prefers when both are available.'
    : '';

  if (ipv4Reachable && ipv6Reachable) {
    return {
      ipv4Reachable,
      ipv6Reachable,
      verdict: 'dual-stack',
      explanation:
        'Both IPv4-only and IPv6-only hosts answered, so this connection carries both address ' +
        `families end to end.${preference}`,
    };
  }

  if (ipv4Reachable && !ipv6Reachable) {
    return {
      ipv4Reachable,
      ipv6Reachable,
      verdict: 'ipv4-only',
      explanation:
        'IPv4-only hosts answered and no IPv6-only host did. Either this network has no IPv6 ' +
        'path or something along it is dropping IPv6. This is common and mostly harmless — it ' +
        'only bites on services that publish no IPv4 address at all.',
    };
  }

  if (!ipv4Reachable && ipv6Reachable) {
    return {
      ipv4Reachable,
      ipv6Reachable,
      verdict: 'ipv6-only',
      explanation:
        'IPv6-only hosts answered and no IPv4-only host did. That is unusual; on most IPv6-only ' +
        'networks a translation layer still makes IPv4 destinations reachable, so IPv4 failing ' +
        'outright is worth investigating.',
    };
  }

  return {
    ipv4Reachable,
    ipv6Reachable,
    verdict: 'neither-family-answered',
    explanation:
      'No probe host answered in either family. That points at the connection as a whole rather ' +
      'than at one address family — nothing here distinguishes an IPv6 problem from being ' +
      'offline.',
  };
}

/** Human-readable one-liner for a family reachability tri-state. */
export function describeReachability(reachable: boolean | null): string {
  if (reachable === null) return 'not checked';
  return reachable ? 'answered' : 'no response';
}

/**
 * Runs the full dual-stack check.
 *
 * Probes run concurrently: a blocked family times out rather than answering, so
 * running them in series would make the check as slow as the sum of its
 * failures.
 */
export async function checkDualStack(
  onProgress?: (stage: string) => void,
  signal?: AbortSignal,
): Promise<DualStackResult> {
  const started = performance.now();
  const failures: MeasurementFailure[] = [];

  if (!navigator.onLine) {
    return {
      id: createId('dualstack'),
      timestamp: Date.now(),
      probes: [],
      ipv4Reachable: null,
      ipv6Reachable: null,
      preferredFamily: null,
      preferredFamilySource: null,
      verdict: null,
      explanation:
        'The browser reports no network connection, so no address family was tried. Nothing ' +
        'here says anything about IPv4 or IPv6 on this machine.',
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

  onProgress?.('Contacting IPv4-only and IPv6-only hosts');
  const probes = await Promise.all(
    FAMILY_ENDPOINTS.map((endpoint) => probeFamilyEndpoint(endpoint, signal)),
  );

  onProgress?.('Asking a dual-stack host which address it sees');
  let preferredFamily: AddressFamily | null = null;
  let preferredFamilySource: string | null = null;
  try {
    const gate = timeoutSignal(PROBE_TIMEOUT_MS, signal);
    try {
      const res = await fetch(`${PREFERENCE_URL}?_nr=${Date.now()}`, {
        cache: 'no-store',
        signal: gate.signal,
      });
      if (!res.ok) throw new Error(`speed.cloudflare.com/meta returned ${res.status}`);
      const meta = await res.json();
      preferredFamily = familyOfIp(meta.clientIp);
      if (preferredFamily === null) {
        failures.push({
          metric: 'preferredFamily',
          reason: 'unsupported-api',
          detail:
            'The dual-stack host did not report a readable client address, so the family the ' +
            'browser prefers is unknown.',
        });
      } else {
        preferredFamilySource = 'speed.cloudflare.com/meta';
      }
    } finally {
      gate.done();
    }
  } catch (e) {
    failures.push({
      metric: 'preferredFamily',
      reason: 'api-unreachable',
      detail:
        'Could not reach the dual-stack reference host, so which address family the browser ' +
        `prefers was not determined. (${e instanceof Error ? e.message : 'request failed'})`,
    });
  }

  const classification = classifyDualStack(probes, preferredFamily);

  for (const family of ['ipv4', 'ipv6'] as const) {
    const list = probes.filter((p) => p.family === family);
    if (list.length > 0 && list.every((p) => p.outcome === 'no-response')) {
      failures.push({
        metric: `${family}Reachable`,
        reason: 'api-unreachable',
        detail:
          `Neither ${label(family)}-only probe host answered. This is consistent with having no ` +
          `${label(family)} path, but a browser cannot tell that apart from both providers being ` +
          'unreachable for other reasons.',
      });
    }
  }

  return {
    id: createId('dualstack'),
    timestamp: Date.now(),
    probes,
    ipv4Reachable: classification.ipv4Reachable,
    ipv6Reachable: classification.ipv6Reachable,
    preferredFamily,
    preferredFamilySource,
    verdict: classification.verdict,
    explanation: classification.explanation,
    totalTimeMs: Math.round(performance.now() - started),
    failures,
  };
}
