import type {
  CaptivePortalResult,
  DnsIntegrityResult,
  DohComparison,
  IntegrityProbe,
  MeasurementFailure,
} from '../types';
import { createId, queryDnsOverHttps } from './network';

/**
 * Captive-portal and DNS-hijack detection.
 *
 * The textbook captive-portal check — request `http://…/generate_204` and see
 * whether a portal answers with a redirect instead of an empty 204 — is not
 * available to this app as deployed. A page served over https: may not open a
 * plaintext http: connection at all, so the request never leaves the browser.
 * That limitation is reported (`mixed-content-blocked`), not worked around, and
 * the probe *is* run when NetReady is opened from a local http: origin.
 *
 * Over https: the observable signature is different, and this is the part worth
 * understanding: a captive portal cannot rewrite an HTTPS response without
 * breaking the certificate chain. So it does not show up as tampered content —
 * it shows up as secure connections failing while `navigator.onLine` still
 * reports true. Two checks follow from that:
 *
 *   1. **Known-content probes.** Endpoints whose correct response is known in
 *      advance. `verified` means the real server answered. `content-mismatch`
 *      means something answered *in its place*, which on https: implies a
 *      certificate the machine has been made to trust. `no-response` across
 *      every endpoint, while the browser believes it is online, is the portal
 *      signature.
 *
 *   2. **Hostname versus literal IP.** A browser cannot read what the system
 *      resolver returned. It can, however, reach one server two ways: by name,
 *      which uses the resolver, and by literal address, which does not. If the
 *      literal answers and the name does not, the resolver is the broken link.
 *      That is a real, low-ambiguity signal, and it is the only DNS test of the
 *      *system* resolver a web page can perform.
 */

const PROBE_TIMEOUT_MS = 6000;

/** Endpoints whose exact response shape is known, so a wrong answer is a
 *  finding rather than noise. Each is already contacted by other NetReady
 *  tools; the check adds no new third party. */
interface KnownEndpoint {
  label: string;
  url: string;
  expectation: string;
  /** Returns true when the body is unmistakably this endpoint's own. */
  verify: (body: string) => boolean;
}

const KNOWN_ENDPOINTS: KnownEndpoint[] = [
  {
    label: 'Cloudflare edge metadata',
    url: 'https://speed.cloudflare.com/meta',
    expectation: 'JSON naming the Cloudflare edge that served the request',
    verify: (body) => hasJsonKey(body, 'colo'),
  },
  {
    label: 'Google DNS-over-HTTPS',
    url: 'https://dns.google/resolve?name=one.one.one.one&type=A',
    expectation: 'a DNS-over-HTTPS answer with a numeric Status field',
    verify: (body) => hasJsonKey(body, 'Status'),
  },
  {
    label: 'jsDelivr package metadata',
    url: 'https://cdn.jsdelivr.net/npm/tiny-inflate@1.0.3/package.json',
    expectation: 'the published package.json for tiny-inflate',
    verify: (body) => {
      try {
        return JSON.parse(body)?.name === 'tiny-inflate';
      } catch {
        return false;
      }
    },
  },
];

/** Plaintext captive-portal endpoint, usable only from an http: origin. */
const GENERATE_204_URL = 'http://cp.cloudflare.com/generate_204';

/** Same Cloudflare server, reached two ways. The literal needs no DNS. */
const DNS_HOSTNAME_PROBE = 'https://one.one.one.one/cdn-cgi/trace';
const DNS_LITERAL_PROBE = 'https://1.1.1.1/cdn-cgi/trace';

/**
 * Names whose correct answer is the same everywhere on earth.
 *
 * This matters more than it looks. Comparing two resolvers on an ordinary CDN
 * hostname produces disagreement constantly and legitimately, because the whole
 * point of a CDN is to answer differently by location. Anycast infrastructure
 * names do not do that, so a divergence here is signal rather than geography.
 */
const STABLE_NAMES = ['one.one.one.one', 'dns.google'];

function hasJsonKey(body: string, key: string): boolean {
  try {
    const parsed = JSON.parse(body);
    return parsed !== null && typeof parsed === 'object' && key in parsed;
  } catch {
    return false;
  }
}

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

/** True when the current page may open plaintext http: connections. */
export function canProbePlaintext(protocol: string): boolean {
  return protocol === 'http:';
}

async function probeKnownEndpoint(
  endpoint: KnownEndpoint,
  signal?: AbortSignal,
): Promise<IntegrityProbe> {
  const url = `${endpoint.url}${endpoint.url.includes('?') ? '&' : '?'}_nr=${Date.now()}`;
  const started = performance.now();
  const gate = timeoutSignal(PROBE_TIMEOUT_MS, signal);

  try {
    const res = await fetch(url, { cache: 'no-store', mode: 'cors', signal: gate.signal });
    const body = await res.text();
    const roundTripMs = Math.round(performance.now() - started);
    const verified = res.ok && endpoint.verify(body);

    return {
      label: endpoint.label,
      url: endpoint.url,
      expectation: endpoint.expectation,
      outcome: verified ? 'verified' : 'content-mismatch',
      roundTripMs,
      note: verified
        ? null
        : `Answered with HTTP ${res.status}, but the body was not ${endpoint.expectation}. ` +
          'Something responded in this endpoint’s place.',
    };
  } catch (e) {
    return {
      label: endpoint.label,
      url: endpoint.url,
      expectation: endpoint.expectation,
      outcome: 'no-response',
      roundTripMs: null,
      note: e instanceof Error ? e.message : 'Request failed',
    };
  } finally {
    gate.done();
  }
}

/**
 * The classic plaintext probe, run only where the browser permits it.
 *
 * `redirect: 'error'` turns a portal's 302 into a rejected promise, which is
 * the whole signal: the correct response is a bodyless 204 and nothing else.
 */
async function probeGenerate204(pageProtocol: string, signal?: AbortSignal): Promise<IntegrityProbe> {
  const base: Omit<IntegrityProbe, 'outcome' | 'roundTripMs' | 'note'> = {
    label: 'Plaintext captive-portal probe',
    url: GENERATE_204_URL,
    expectation: 'an empty HTTP 204 with no redirect',
  };

  if (!canProbePlaintext(pageProtocol)) {
    return {
      ...base,
      outcome: 'not-attempted',
      roundTripMs: null,
      note:
        `This page is served over ${pageProtocol.replace(':', '')}, and a secure page may not ` +
        'open a plaintext connection. The classic 204 redirect check is therefore unavailable ' +
        'here; it runs when NetReady is opened over plain http.',
    };
  }

  const started = performance.now();
  const gate = timeoutSignal(PROBE_TIMEOUT_MS, signal);
  try {
    const res = await fetch(`${GENERATE_204_URL}?_nr=${Date.now()}`, {
      cache: 'no-store',
      mode: 'cors',
      redirect: 'error',
      signal: gate.signal,
    });
    const roundTripMs = Math.round(performance.now() - started);
    if (res.status === 204) {
      return { ...base, outcome: 'verified', roundTripMs, note: null };
    }
    return {
      ...base,
      outcome: 'content-mismatch',
      roundTripMs,
      note: `Expected HTTP 204 and got HTTP ${res.status}. A captive portal answers exactly like this.`,
    };
  } catch (e) {
    return {
      ...base,
      outcome: 'no-response',
      roundTripMs: null,
      note: e instanceof Error ? e.message : 'Request failed',
    };
  } finally {
    gate.done();
  }
}

export interface InterceptionClassification {
  verdict: CaptivePortalResult['verdict'];
  explanation: string;
}

/**
 * Turns known-content probe outcomes into a verdict. Pure and exhaustively
 * tested, because this is the function whose wording a user acts on.
 *
 * `browserOnline` is a parameter rather than a `navigator` read so the
 * distinction that matters — offline versus online-but-blocked — can be tested
 * without a browser.
 */
export function classifyInterception(
  probes: readonly IntegrityProbe[],
  browserOnline: boolean,
): InterceptionClassification {
  const attempted = probes.filter((p) => p.outcome !== 'not-attempted');

  if (attempted.length === 0) {
    return {
      verdict: null,
      explanation: 'No integrity probe ran, so nothing is known about interception on this network.',
    };
  }

  const mismatched = attempted.filter((p) => p.outcome === 'content-mismatch');
  const verified = attempted.filter((p) => p.outcome === 'verified');
  const silent = attempted.filter((p) => p.outcome === 'no-response');

  if (mismatched.length > 0) {
    return {
      verdict: 'content-substituted',
      explanation:
        `${mismatched.length} of ${attempted.length} endpoints returned something other than ` +
        'their own content. Over HTTPS that requires a certificate this machine has been made ' +
        'to trust, which means a filtering proxy, corporate inspection appliance, or captive ' +
        'portal is reading the traffic.',
    };
  }

  if (verified.length === attempted.length) {
    return {
      verdict: 'no-interception-detected',
      explanation:
        `All ${attempted.length} endpoints returned exactly their own content, so nothing is ` +
        'standing in for them. This rules out substitution on these endpoints; it does not ' +
        'certify the whole network.',
    };
  }

  if (silent.length === attempted.length) {
    return {
      verdict: browserOnline ? 'https-blocked' : null,
      explanation: browserOnline
        ? 'The browser reports a working connection, yet no HTTPS endpoint answered. That is the ' +
          'signature of a captive portal you have not signed in to, or of a firewall blocking ' +
          'outbound HTTPS — a portal cannot forge an HTTPS response, so it blocks instead.'
        : 'Nothing answered, and the browser reports no network connection. There is no ' +
          'interception to detect here; there is no connection.',
    };
  }

  return {
    verdict: 'mixed',
    explanation:
      `${verified.length} of ${attempted.length} endpoints answered correctly and ` +
      `${silent.length} did not answer at all. That is neither a clean pass nor the pattern a ` +
      'portal produces, and more often means one provider is unreachable from this network.',
  };
}

/** Runs the interception checks. */
export async function checkCaptivePortal(
  onProgress?: (stage: string) => void,
  signal?: AbortSignal,
): Promise<CaptivePortalResult> {
  const started = performance.now();
  const pageProtocol = typeof location === 'undefined' ? 'https:' : location.protocol;
  const failures: MeasurementFailure[] = [];

  onProgress?.('Checking whether known endpoints return their own content');
  const probes: IntegrityProbe[] = [
    await probeGenerate204(pageProtocol, signal),
    ...(await Promise.all(KNOWN_ENDPOINTS.map((e) => probeKnownEndpoint(e, signal)))),
  ];

  const plaintext = probes[0];
  if (plaintext.outcome === 'not-attempted') {
    failures.push({
      metric: 'generate204',
      reason: 'mixed-content-blocked',
      detail: plaintext.note ?? 'The plaintext captive-portal probe could not be attempted.',
    });
  }

  const classification = classifyInterception(probes, navigator.onLine);
  if (classification.verdict === null) {
    failures.push({
      metric: 'interception',
      reason: navigator.onLine ? 'insufficient-samples' : 'network-offline',
      detail: classification.explanation,
    });
  }

  return {
    id: createId('captive'),
    timestamp: Date.now(),
    pageProtocol,
    probes,
    verdict: classification.verdict,
    explanation: classification.explanation,
    totalTimeMs: Math.round(performance.now() - started),
    failures,
  };
}

/** Did a connection to this URL complete at all? Opaque responses count — the
 *  question is whether the browser got anywhere, not what it was told. */
async function reachable(url: string, signal?: AbortSignal): Promise<boolean> {
  const gate = timeoutSignal(PROBE_TIMEOUT_MS, signal);
  try {
    await fetch(`${url}${url.includes('?') ? '&' : '?'}_nr=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
      mode: 'no-cors',
      signal: gate.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    gate.done();
  }
}

/** Sorted record data, so comparison is order-independent. */
function answerSet(records: { data: string }[]): string[] {
  return records.map((r) => r.data.trim()).sort();
}

export interface DnsClassification {
  verdict: DnsIntegrityResult['verdict'];
  explanation: string;
}

/**
 * Turns the two DNS observations into a verdict. Pure.
 *
 * The precedence is deliberate: a resolver that cannot resolve is a bigger
 * finding than two providers disagreeing, and "both paths failed" is reported as
 * unknown rather than as a DNS fault, because a dead connection fails both.
 */
export function classifyDnsIntegrity(
  hostnameReachable: boolean | null,
  literalIpReachable: boolean | null,
  comparisons: readonly DohComparison[],
): DnsClassification {
  if (literalIpReachable === true && hostnameReachable === false) {
    return {
      verdict: 'resolver-failing',
      explanation:
        'The same server answered on its literal IP address but not by name. The connection ' +
        'works; name resolution on this network does not. That is a broken, blocked or ' +
        'redirected DNS resolver.',
    };
  }

  const disagreements = comparisons.filter((c) => c.agrees === false);
  if (disagreements.length > 0) {
    return {
      verdict: 'answers-diverge',
      explanation:
        `Two independent DNS-over-HTTPS providers returned different addresses for ` +
        `${disagreements.map((d) => d.name).join(', ')}. These names answer identically ` +
        'worldwide, so a difference points at manipulation rather than at geography.',
    };
  }

  if (hostnameReachable === true) {
    const compared = comparisons.filter((c) => c.agrees === true).length;
    return {
      verdict: 'resolver-working',
      explanation:
        'Hostnames resolved and the server answered by name.' +
        (compared > 0
          ? ` Two independent DNS-over-HTTPS providers also agreed on ${compared} name(s) whose ` +
            'correct answer is the same worldwide.'
          : ''),
    };
  }

  if (hostnameReachable === false && literalIpReachable === false) {
    return {
      verdict: null,
      explanation:
        'Neither the hostname nor the literal IP answered. Nothing got out at all, so this says ' +
        'nothing about DNS specifically — fix reachability first.',
    };
  }

  return {
    verdict: null,
    explanation: 'Not enough of the DNS check completed to reach a verdict.',
  };
}

/** Runs the DNS integrity check. */
export async function checkDnsIntegrity(
  onProgress?: (stage: string) => void,
  signal?: AbortSignal,
): Promise<DnsIntegrityResult> {
  const started = performance.now();
  const failures: MeasurementFailure[] = [];

  if (!navigator.onLine) {
    return {
      id: createId('dnscheck'),
      timestamp: Date.now(),
      hostnameReachable: null,
      literalIpReachable: null,
      hostnameProbed: DNS_HOSTNAME_PROBE,
      literalProbed: DNS_LITERAL_PROBE,
      comparisons: [],
      verdict: null,
      explanation:
        'The browser reports no network connection, so no name was resolved and no address was ' +
        'contacted.',
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

  onProgress?.('Comparing name resolution against a literal address');
  const [hostnameReachable, literalIpReachable] = await Promise.all([
    reachable(DNS_HOSTNAME_PROBE, signal),
    reachable(DNS_LITERAL_PROBE, signal),
  ]);

  onProgress?.('Cross-checking two DNS-over-HTTPS providers');
  const comparisons: DohComparison[] = [];
  for (const name of STABLE_NAMES) {
    if (signal?.aborted) break;
    const [cf, goog] = await Promise.all([
      queryDnsOverHttps(name, 'A', 'cloudflare'),
      queryDnsOverHttps(name, 'A', 'google'),
    ]);

    // Status 0 is NOERROR. Anything else means the provider did not answer the
    // question, which is missing data — not a disagreement.
    const cloudflare = cf.status === 0 && cf.records.length > 0 ? answerSet(cf.records) : null;
    const google = goog.status === 0 && goog.records.length > 0 ? answerSet(goog.records) : null;

    comparisons.push({
      name,
      cloudflare,
      google,
      agrees:
        cloudflare === null || google === null
          ? null
          : cloudflare.length === google.length && cloudflare.every((v, i) => v === google[i]),
    });
  }

  const unresolved = comparisons.filter((c) => c.agrees === null);
  if (unresolved.length > 0) {
    failures.push({
      metric: 'dohComparison',
      reason: 'api-unreachable',
      detail:
        `${unresolved.length} name(s) could not be compared because at least one DNS-over-HTTPS ` +
        'provider did not return an answer. A missing answer is not a disagreement.',
    });
  }

  const classification = classifyDnsIntegrity(hostnameReachable, literalIpReachable, comparisons);
  if (classification.verdict === null) {
    failures.push({
      metric: 'dnsVerdict',
      reason: 'insufficient-samples',
      detail: classification.explanation,
    });
  }

  return {
    id: createId('dnscheck'),
    timestamp: Date.now(),
    hostnameReachable,
    literalIpReachable,
    hostnameProbed: DNS_HOSTNAME_PROBE,
    literalProbed: DNS_LITERAL_PROBE,
    comparisons,
    verdict: classification.verdict,
    explanation: classification.explanation,
    totalTimeMs: Math.round(performance.now() - started),
    failures,
  };
}
