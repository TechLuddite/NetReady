import type {
  DnsBenchmarkResult,
  DnsMetricSummary,
  DnsProbeKind,
  DnssecValidation,
  MeasurementFailure,
  NxdomainHonesty,
  ResolverBenchmark,
  ResolverOutcome,
} from '../types';
import { createId, summariseSamples, timeoutSignal } from './network';
import { readPhases } from './edgePath';
import {
  DNS_TYPE,
  decodeDnsMessage,
  encodeDnsQuery,
  rcodeName,
  toBase64Url,
  type DnsMessage,
} from './dnsWire';

/**
 * DNS resolver benchmark, after Steve Gibson's GRC DNS Benchmark.
 *
 * His tool sends UDP queries straight to a nameserver's IP and separates three
 * kinds of lookup — one already in the resolver's cache, one that forces the
 * resolver out to an authoritative server, and one that forces it to consult
 * the .com TLD servers. That separation is the insight worth borrowing: a
 * resolver can be instant from cache and badly connected to everything else,
 * and a benchmark that mixes the two tells you neither.
 *
 * What a browser can reproduce, and what it cannot:
 *
 *   - It cannot open a UDP socket, so nothing here touches port 53. Every
 *     measurement is an RFC 8484 DNS-over-HTTPS request, and every millisecond
 *     includes TLS, HTTP framing and the operator's front-end.
 *   - It cannot discover the address of the system resolver, cannot query it,
 *     and cannot force a fresh lookup through it whose timing is readable. The
 *     resolver a user is actually using is therefore absent from these results.
 *     That is stated in the UI, not approximated.
 *   - It cannot query a provider that omits `Access-Control-Allow-Origin`. Ten
 *     well-known resolvers are unreachable for that reason alone, and they are
 *     listed rather than quietly dropped.
 *   - It cannot count dropped DNS queries. TCP and TLS hide packet loss; what
 *     is observable is a failed HTTPS request, which is not the same thing and
 *     is never labelled "reliability".
 *
 * The three lookup kinds still work, though, and they work honestly: a random
 * label under a popular domain is guaranteed not to be in any cache, and a
 * random second-level `.com` name forces a TLD consultation. Both were verified
 * against all seven endpoints below before this was written.
 */

export interface DohResolver {
  id: string;
  label: string;
  operator: string;
  endpoint: string;
  /** The operator's own published policy, quoted for context so a user can tell
   *  a filtering resolver from an unfiltered one. NetReady does not verify it
   *  and derives no verdict from it. */
  policyNote: string;
}

/**
 * Resolvers this tool can actually query.
 *
 * Membership is decided by one thing only: whether the endpoint sends
 * `Access-Control-Allow-Origin`, without which a browser cannot read the
 * response at all. Each of these was confirmed to answer RFC 8484 wireformat
 * queries cross-origin on 2026-08-16.
 */
export const DOH_RESOLVERS: DohResolver[] = [
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    operator: 'Cloudflare, Inc.',
    endpoint: 'https://cloudflare-dns.com/dns-query',
    policyNote: 'Operator states: unfiltered.',
  },
  {
    id: 'google',
    label: 'Google Public DNS',
    operator: 'Google LLC',
    endpoint: 'https://dns.google/dns-query',
    policyNote: 'Operator states: unfiltered.',
  },
  {
    id: 'quad9',
    label: 'Quad9',
    operator: 'Quad9 Foundation',
    endpoint: 'https://dns.quad9.net/dns-query',
    policyNote: 'Operator states: blocks known malicious domains.',
  },
  {
    id: 'quad9-unfiltered',
    label: 'Quad9 (unfiltered)',
    operator: 'Quad9 Foundation',
    endpoint: 'https://dns10.quad9.net/dns-query',
    policyNote: 'Operator states: no blocking, no DNSSEC validation.',
  },
  {
    id: 'controld',
    label: 'Control D',
    operator: 'Control D Inc.',
    endpoint: 'https://freedns.controld.com/p0',
    policyNote: 'Operator states: unfiltered (the p0 profile).',
  },
  {
    id: 'dnssb',
    label: 'DNS.SB',
    operator: 'xTom / DNS.SB',
    endpoint: 'https://doh.sb/dns-query',
    policyNote: 'Operator states: unfiltered, no logging.',
  },
  {
    id: 'iij',
    label: 'IIJ Public DNS',
    operator: 'Internet Initiative Japan',
    endpoint: 'https://public.dns.iij.jp/dns-query',
    policyNote: 'Operator states: unfiltered.',
  },
];

/**
 * Public DoH resolvers a browser cannot query.
 *
 * These sent no `Access-Control-Allow-Origin` header when the list was compiled
 * (2026-08-16), so `fetch` discards their responses before any script can read
 * them. They are listed rather than omitted for the same reason
 * `describeTargetExpansion` exists: a short list that does not say why it is
 * short reads as a complete one. Their absence is a browser limitation, not a
 * judgement about the operators, and NetReady never sends them a query.
 */
export const CORS_BLOCKED_RESOLVERS: { label: string; endpoint: string }[] = [
  { label: 'OpenDNS', endpoint: 'https://doh.opendns.com/dns-query' },
  { label: 'AdGuard DNS', endpoint: 'https://dns.adguard-dns.com/dns-query' },
  { label: 'Mullvad DNS', endpoint: 'https://dns.mullvad.net/dns-query' },
  { label: 'NextDNS', endpoint: 'https://dns.nextdns.io' },
  { label: 'Cisco Umbrella', endpoint: 'https://doh.umbrella.com/dns-query' },
  { label: 'Yandex DNS', endpoint: 'https://common.dot.dns.yandex.net/dns-query' },
  { label: 'LibreDNS', endpoint: 'https://doh.libredns.gr/dns-query' },
  { label: 'CIRA Canadian Shield', endpoint: 'https://private.canadianshield.cira.ca/dns-query' },
  { label: 'Wikimedia DNS', endpoint: 'https://wikimedia-dns.org/dns-query' },
  { label: 'Digitale Gesellschaft', endpoint: 'https://dns.digitale-gesellschaft.ch/dns-query' },
];

/**
 * Names near-certain to be in any public resolver's cache.
 *
 * Five rather than one: a single name whose TTL happened to expire partway
 * through a run would turn that resolver's "cached" figure into an uncached one
 * and make it look slow for a reason that has nothing to do with the resolver.
 */
export const POPULAR_NAMES = [
  'google.com',
  'youtube.com',
  'facebook.com',
  'wikipedia.org',
  'amazon.com',
];

/** Comcast's public test domain: its DNSSEC chain is deliberately broken, so a
 *  validating resolver must refuse to serve it. */
const DNSSEC_BROKEN_NAME = 'dnssec-failed.org';
/** A correctly signed control. A validating resolver sets the AD bit on it. */
const DNSSEC_SIGNED_NAME = 'internetsociety.org';

export const SAMPLES_PER_METRIC = 5;

/**
 * Per-query deadline.
 *
 * Deliberately shorter than the 6 s `PROBE_TIMEOUT_MS` the one-shot checks use:
 * this is a loop of ~150 queries, and a DoH answer slower than 2.5 s is itself
 * the finding rather than something worth waiting out.
 */
const QUERY_TIMEOUT_MS = 2500;

/** After this many consecutive silences a resolver's remaining queries are not
 *  sent. They are recorded as `not-attempted`, which is true, rather than as
 *  failures the resolver never had the chance to cause. */
const CONSECUTIVE_FAILURES_BEFORE_GIVING_UP = 2;

/** Minimum answered queries before any statistic is reported for a metric. */
export const MIN_SAMPLES_PER_METRIC = 3;

/**
 * Fresh 16-bit DNS message ID per query.
 *
 * RFC 8484 §4.1 recommends id = 0 so identical queries are byte-identical and
 * HTTP caches can share them. This tool wants precisely the opposite: a cached
 * HTTP response would report the browser's disk latency as the resolver's DNS
 * latency. Randomising the ID changes the `dns=` parameter itself, which is the
 * only cache-buster that works here — appending an extra query parameter such
 * as `&_nr=` makes Quad9 reject the request with HTTP 403.
 *
 * It doubles as a correctness check: a reply whose ID does not match the query
 * did not come from this query.
 */
function randomMessageId(): number {
  const buf = new Uint16Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

const LABEL_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Random DNS label, for names that must not be in anyone's cache. */
function randomLabel(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  // Start with a letter: a leading digit is legal in a hostname label but not
  // universally handled, and this is not the place to find that out.
  out += LABEL_ALPHABET[bytes[0] % 26];
  for (let i = 1; i < length; i++) out += LABEL_ALPHABET[bytes[i] % LABEL_ALPHABET.length];
  return out;
}

export type ProbeStatus =
  | 'answered'
  /** The resolver replied, but not with something usable — an HTTP error, an
   *  undecodable body, a reply that did not match the query. Distinct from
   *  `request-failed` because reading any of that proves the request completed
   *  and the browser was allowed to see the response. */
  | 'no-answer'
  /** Nothing came back at all. `fetch` rejected, and a browser cannot say why. */
  | 'request-failed'
  | 'blocked-by-browser'
  | 'timeout'
  | 'not-attempted';

export interface DnsProbeOutcome {
  /** Wall clock around the fetch. Null whenever nothing readable came back —
   *  including for an HTTP error, because timing a rate-limit rejection would
   *  put it in the median as though it were a lookup. */
  roundTripMs: number | null;
  message: DnsMessage | null;
  status: ProbeStatus;
  note: string | null;
}

const notAttempted = (note: string): DnsProbeOutcome => ({
  roundTripMs: null,
  message: null,
  status: 'not-attempted',
  note,
});

/**
 * Sends one DoH query and times it.
 *
 * Kept a CORS *simple* request on purpose: method GET, and `Accept` is the only
 * header, with a value that is on the safelist. Any custom header would trigger
 * an `OPTIONS` preflight, which several of these endpoints reject — and the
 * rejection would look exactly like "this resolver is unreachable".
 */
export async function queryResolver(
  endpoint: string,
  name: string,
  qtype: number,
  options: { dnssecOk?: boolean; corsBlocked?: boolean } = {},
  signal?: AbortSignal,
): Promise<DnsProbeOutcome> {
  if (options.corsBlocked) {
    return {
      roundTripMs: null,
      message: null,
      status: 'blocked-by-browser',
      note: 'This page is not permitted to read responses from this endpoint.',
    };
  }

  const id = randomMessageId();
  const wire = encodeDnsQuery(name, { id, qtype, dnssecOk: options.dnssecOk ?? false });
  if (wire === null) {
    // Our own encoder refused the name. That is a bug in the caller, not a
    // result about the resolver, so it must not be recorded as one.
    return notAttempted(`The name “${name}” could not be encoded as a DNS query.`);
  }

  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}dns=${toBase64Url(wire)}`;
  const gate = timeoutSignal(QUERY_TIMEOUT_MS, signal);
  const started = performance.now();

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/dns-message' },
      cache: 'no-store',
      mode: 'cors',
      signal: gate.signal,
    });
    const elapsed = performance.now() - started;

    if (!res.ok) {
      return {
        roundTripMs: null,
        message: null,
        status: 'no-answer',
        note: `The resolver declined the query with HTTP ${res.status}.`,
      };
    }

    const message = decodeDnsMessage(new Uint8Array(await res.arrayBuffer()));
    if (message === null) {
      return {
        roundTripMs: null,
        message: null,
        status: 'no-answer',
        note: 'The response was not a readable DNS message.',
      };
    }

    if (message.header.id !== id) {
      // The random ID pays for itself here: a mismatched reply is a stale cache
      // hit or a crossed wire, and timing it would be timing the wrong thing.
      return {
        roundTripMs: null,
        message: null,
        status: 'no-answer',
        note: 'The reply did not match the query that was sent.',
      };
    }

    return { roundTripMs: elapsed, message, status: 'answered', note: null };
  } catch (error) {
    if (signal?.aborted) return notAttempted('The run was stopped before this query was sent.');
    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        roundTripMs: null,
        message: null,
        status: 'timeout',
        note: `No answer within ${QUERY_TIMEOUT_MS} ms.`,
      };
    }
    return {
      roundTripMs: null,
      message: null,
      status: 'request-failed',
      note: error instanceof Error ? error.message : 'The request failed.',
    };
  } finally {
    gate.done();
  }
}

/**
 * Decides whether a `fetch` rejection was the browser refusing to show us a
 * response, or nothing arriving at all.
 *
 * `TypeError: Failed to fetch` is emitted identically for a CORS rejection, a
 * DNS failure, a refused connection, a TLS failure, an extension block and
 * being offline. Picking one would be a guess. Repeating the request in
 * `no-cors` mode settles it: if that resolves, the connection completed and the
 * browser withheld the body, which is CORS. If it also fails, nothing got
 * through and we say so without claiming to know which.
 *
 * Only ever called for `request-failed`. An HTTP error is not ambiguous and
 * must never come through here: reading a status code at all proves the browser
 * was allowed to see the response. Calling a resolver CORS-blocked on the
 * strength of a 503 would be asserting something its own reply disproves — an
 * earlier version of this file did exactly that to a resolver returning 505.
 *
 * This is the same two-step already used by `probeFamilyEndpoint`. Note that
 * the retry sends a real query the resolver will log, which is why it runs at
 * most once per resolver per run — and why it appears in the privacy
 * disclosure. An opaque success proves the connection completed and nothing
 * more; it cannot distinguish 200 from 403, so it never yields a timing sample.
 */
async function probeIsCorsBlocked(
  endpoint: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const wire = encodeDnsQuery('example.com', { id: randomMessageId(), qtype: DNS_TYPE.A });
  if (wire === null) return false;
  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}dns=${toBase64Url(wire)}`;
  const gate = timeoutSignal(QUERY_TIMEOUT_MS, signal);
  try {
    await fetch(url, { method: 'GET', cache: 'no-store', mode: 'no-cors', signal: gate.signal });
    return true;
  } catch {
    return false;
  } finally {
    gate.done();
  }
}

// ---------------------------------------------------------------------------
// Pure classifiers. Everything the user reads is produced here, so every branch
// is testable without a network.
// ---------------------------------------------------------------------------

const addressAnswers = (outcome: DnsProbeOutcome): number =>
  (outcome.message?.answers ?? []).filter(
    (a) => a.type === DNS_TYPE.A || a.type === DNS_TYPE.AAAA,
  ).length;

/**
 * Whether a resolver tells the truth about names that do not exist.
 *
 * GRC calls the failure mode "redirection" and colours those nameservers
 * orange: instead of NXDOMAIN, some operators return an address so a browser
 * lands on a search or advertising page.
 *
 * Both probes must come back with an address before that is claimed. One is
 * within the noise of a parked wildcard or a registry glitch, and the accusation
 * is specific enough to be worth being sure about. Anything else — SERVFAIL,
 * REFUSED, silence — is `inconclusive`, not `honest`: a resolver that failed to
 * answer has not demonstrated honesty.
 */
export function classifyNxdomain(outcomes: readonly DnsProbeOutcome[]): {
  honesty: NxdomainHonesty;
  detail: string;
} {
  const answered = outcomes.filter((o) => o.status === 'answered' && o.message !== null);
  if (answered.length === 0) {
    return {
      honesty: 'inconclusive',
      detail: 'No usable reply came back for the made-up names, so this could not be checked.',
    };
  }

  const withAddress = answered.filter((o) => addressAnswers(o) > 0);
  if (withAddress.length === answered.length && answered.length >= 2) {
    return {
      honesty: 'answers-with-an-address',
      detail:
        'Asked for names that do not exist, this resolver returned an address instead of ' +
        '“no such name”. A browser sent to that address usually lands on a search or ' +
        'advertising page. What is observable here is the address, not the reason for it.',
    };
  }

  if (withAddress.length > 0) {
    return {
      honesty: 'inconclusive',
      detail:
        'One made-up name got an address back and another did not, which is not a consistent ' +
        'enough result to call either way.',
    };
  }

  const allNxdomain = answered.every((o) => o.message!.header.rcode === 3);
  if (allNxdomain) {
    return {
      honesty: 'honest',
      detail: 'Names that do not exist came back as NXDOMAIN, which is the correct answer.',
    };
  }

  const codes = [...new Set(answered.map((o) => rcodeName(o.message!.header.rcode)))].join(', ');
  return {
    honesty: 'inconclusive',
    detail: `The made-up names produced ${codes} rather than NXDOMAIN, which settles nothing either way.`,
  };
}

/**
 * Whether a resolver validates DNSSEC.
 *
 * Both signals must agree. Either on its own is ambiguous: a resolver that is
 * simply broken for one name also returns SERVFAIL, and a resolver can set the
 * AD bit without ever refusing a broken chain. Disagreement is reported as
 * inconclusive rather than resolved in the resolver's favour.
 *
 * Note what the AD bit is: the resolver's *claim* that it validated. A browser
 * cannot check the signature chain itself, which is why the broken-chain probe
 * is the half that carries the weight.
 */
export function classifyDnssec(
  brokenChain: DnsProbeOutcome,
  signedControl: DnsProbeOutcome,
): { validation: DnssecValidation; detail: string } {
  const brokenMsg = brokenChain.status === 'answered' ? brokenChain.message : null;
  const signedMsg = signedControl.status === 'answered' ? signedControl.message : null;

  if (brokenMsg === null || signedMsg === null) {
    return {
      validation: 'inconclusive',
      detail:
        'One of the two DNSSEC test names did not produce a usable reply, so validation could ' +
        'not be determined. Both halves are needed: one name with a deliberately broken ' +
        'signature chain, and one correctly signed name as a control.',
    };
  }

  const refusedBrokenChain = brokenMsg.header.rcode === 2; // SERVFAIL
  const claimsAuthenticated = signedMsg.header.ad;

  if (refusedBrokenChain && claimsAuthenticated) {
    return {
      validation: 'validates',
      detail:
        'This resolver refused to serve a name with a deliberately broken signature chain, and ' +
        'set the AD bit on a correctly signed name. The AD bit is the resolver’s own claim — a ' +
        'browser cannot verify the chain itself — but the refusal is behaviour, and the two agree.',
    };
  }

  if (!refusedBrokenChain && !claimsAuthenticated) {
    return {
      validation: 'does-not-validate',
      detail:
        'This resolver served a name whose signature chain is deliberately broken, and did not ' +
        'mark a correctly signed name as authenticated. It is passing DNSSEC records through ' +
        'rather than checking them.',
    };
  }

  return {
    validation: 'inconclusive',
    detail: refusedBrokenChain
      ? 'This resolver refused the broken-chain name but did not set the AD bit on the signed ' +
        'control, so the two signals disagree.'
      : 'This resolver set the AD bit on the signed control but still served the broken-chain ' +
        'name, so the two signals disagree.',
  };
}

/** Whether a resolver produced enough to be worth reading. */
export function classifyResolver(row: {
  label: string;
  cached: DnsMetricSummary;
  uncached: DnsMetricSummary;
  dotcom: DnsMetricSummary;
  corsBlocked: boolean;
  everAttempted: boolean;
  /** Whether any HTTP response was read from this resolver, usable or not. It
   *  changes what can honestly be said about a failure. */
  sawHttpResponse: boolean;
  /** The last thing that went wrong, quoted into the note when it is known. */
  lastNote?: string | null;
}): { outcome: ResolverOutcome; note: string } {
  if (row.corsBlocked) {
    return {
      outcome: 'blocked-by-browser',
      note:
        `${row.label} does not send the header that lets a web page read its answers, so a ` +
        'browser cannot query it at all. This is a limitation of running in a browser, not a ' +
        'measurement of the resolver.',
    };
  }

  if (!row.everAttempted) {
    return { outcome: 'not-attempted', note: `No queries were sent to ${row.label}.` };
  }

  const metrics = [row.cached, row.uncached, row.dotcom];
  const answered = metrics.reduce((sum, m) => sum + m.answered, 0);
  const measured = metrics.filter((m) => m.medianMs !== null).length;

  if (answered === 0) {
    // Two different failures, and the difference is knowable. If an HTTP
    // response was read, the request plainly arrived and came back — saying
    // "something may have blocked it" would contradict our own evidence.
    return {
      outcome: 'no-readable-answer',
      note: row.sawHttpResponse
        ? `${row.label} replied, but never with a usable DNS answer` +
          `${row.lastNote ? `: ${row.lastNote}` : '.'}`
        : `No readable answer came back from ${row.label}. A browser cannot tell a resolver that ` +
          'did not reply apart from a request the network or an extension blocked before it left ' +
          '— both fail identically.',
    };
  }

  if (measured === metrics.length) {
    return { outcome: 'measured', note: `${row.label} answered every kind of query.` };
  }

  return {
    outcome: 'partially-measured',
    note:
      `${row.label} answered some queries but not enough of each kind for every figure. ` +
      'Missing figures are shown as “—”.',
  };
}

export interface BenchmarkSummary {
  verdict: DnsBenchmarkResult['verdict'];
  explanation: string;
  fastestCachedResolverId: string | null;
  fastestIsWithinNoise: boolean | null;
  conclusions: string[];
}

/**
 * Distils the table into plain English, in the spirit of GRC's "Conclusions"
 * tab — the part of his tool most users end up relying on.
 *
 * The one claim this deliberately does not make is a statistical one. GRC
 * applies a 95% confidence threshold; there is no significance test whose
 * assumptions hold over five correlated samples sharing one uplink, so instead
 * of inventing a p-value this reports whether the leader's observed range
 * overlaps the runner-up's. "These two overlap, so this run does not separate
 * them" is a statement about what was seen.
 */
export function summariseBenchmark(rows: readonly ResolverBenchmark[]): BenchmarkSummary {
  const measured = rows.filter((r) => r.cached.medianMs !== null);

  if (measured.length === 0) {
    return {
      verdict: rows.length === 0 ? null : 'nothing-measured',
      explanation:
        rows.length === 0
          ? 'Nothing was measured.'
          : 'No resolver produced enough answers to time. Nothing here can be ranked, and the ' +
            'reasons are listed against each one.',
      fastestCachedResolverId: null,
      fastestIsWithinNoise: null,
      conclusions: [],
    };
  }

  const ranked = [...measured].sort((a, b) => a.cached.medianMs! - b.cached.medianMs!);
  const leader = ranked[0];
  const runnerUp = ranked.length > 1 ? ranked[1] : null;

  // Overlap of the two observed ranges. Null rather than false when either
  // range is unknown: "we could not tell" is not "they are distinct".
  let withinNoise: boolean | null = null;
  if (runnerUp !== null) {
    const a = leader.cached;
    const b = runnerUp.cached;
    withinNoise =
      a.maxMs !== null && b.minMs !== null ? a.maxMs >= b.minMs : null;
  }

  const conclusions: string[] = [];

  if (runnerUp === null) {
    conclusions.push(
      `Only ${leader.label} produced enough answers to time, so there is nothing to compare it ` +
        'against. A single result is not a ranking.',
    );
  } else if (withinNoise === true) {
    conclusions.push(
      `${leader.label} had the lowest median for cached lookups (${leader.cached.medianMs} ms), ` +
        `but its range overlaps ${runnerUp.label}’s (${runnerUp.cached.medianMs} ms). This run ` +
        'does not separate them — treat them as equally quick from here.',
    );
  } else if (withinNoise === false) {
    conclusions.push(
      `${leader.label} was fastest for cached lookups at a median of ${leader.cached.medianMs} ms, ` +
        `clear of ${runnerUp.label} at ${runnerUp.cached.medianMs} ms. Cached lookups are the ` +
        'common case, which is why GRC’s benchmark sorts on them first.',
    );
  } else {
    conclusions.push(
      `${leader.label} had the lowest median for cached lookups (${leader.cached.medianMs} ms), ` +
        'but there was not enough spread information to say whether that lead is real.',
    );
  }

  const costed = measured.filter((r) => r.uncachedCostMs !== null);
  if (costed.length > 0) {
    const worst = costed.reduce((a, b) => (b.uncachedCostMs! > a.uncachedCostMs! ? b : a));
    if (worst.uncachedCostMs! > 0) {
      conclusions.push(
        `${worst.label} paid the most to leave its cache: ${worst.uncachedCostMs} ms more for a ` +
          'name it had to look up than for one it already held. That gap is about the resolver’s ' +
          'own connectivity to the rest of the DNS, not about your connection to it.',
      );
    }
  }

  const dishonest = rows.filter((r) => r.nxdomainHonesty === 'answers-with-an-address');
  if (dishonest.length > 0) {
    conclusions.push(
      `${dishonest.map((r) => r.label).join(', ')} returned an address for names that do not ` +
        'exist, instead of saying the name does not exist. That usually means a typo in the ' +
        'address bar lands on a search page rather than a browser error.',
    );
  }

  const validating = rows.filter((r) => r.dnssec === 'validates');
  const notValidating = rows.filter((r) => r.dnssec === 'does-not-validate');
  if (validating.length > 0 || notValidating.length > 0) {
    const parts: string[] = [];
    if (validating.length > 0) parts.push(`${validating.map((r) => r.label).join(', ')} validate`);
    if (notValidating.length > 0) {
      parts.push(`${notValidating.map((r) => r.label).join(', ')} do not`);
    }
    conclusions.push(
      `DNSSEC: ${parts.join('; ')}. A validating resolver refuses to hand you an answer whose ` +
        'signatures do not check out.',
    );
  }

  const unusable = rows.filter((r) => r.outcome === 'no-readable-answer');
  if (unusable.length > 0) {
    conclusions.push(
      `${unusable.map((r) => r.label).join(', ')} produced no readable answer. That may be the ` +
        'resolver, or something between here and it — a browser cannot tell the difference, so ' +
        'this is not evidence that they are slow.',
    );
  }

  conclusions.push(
    'None of this describes the resolver your device is actually using. A web page cannot reach ' +
      'it, so it is not in the table above.',
  );

  const everyMetricMeasured = rows
    .filter((r) => r.outcome !== 'blocked-by-browser')
    .every((r) => r.outcome === 'measured');

  return {
    verdict: everyMetricMeasured ? 'measured' : 'partial',
    explanation: everyMetricMeasured
      ? `All ${measured.length} reachable resolvers answered every kind of query.`
      : `${measured.length} of ${rows.filter((r) => r.outcome !== 'blocked-by-browser').length} ` +
        'reachable resolvers produced timings. The rest are listed with the reason they did not.',
    fastestCachedResolverId: leader.resolverId,
    fastestIsWithinNoise: withinNoise,
    conclusions,
  };
}

/** Difference of the two medians. Null when either is missing; negatives are
 *  kept, because a negative is a real observation about TTLs and anycast. */
export function uncachedCost(
  cached: DnsMetricSummary,
  uncached: DnsMetricSummary,
): number | null {
  if (cached.medianMs === null || uncached.medianMs === null) return null;
  return uncached.medianMs - cached.medianMs;
}

const toMetric = (samples: number[], attempted: number): DnsMetricSummary => {
  const s = summariseSamples(samples, MIN_SAMPLES_PER_METRIC);
  return {
    answered: samples.length,
    attempted,
    medianMs: s.medianMs,
    p95Ms: s.p95Ms,
    minMs: s.minMs,
    maxMs: s.maxMs,
    stdDevMs: s.stdDevMs,
  };
};

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

interface ResolverState {
  resolver: DohResolver;
  samples: Record<DnsProbeKind, number[]>;
  attempts: Record<DnsProbeKind, number>;
  consecutiveFailures: number;
  givenUp: boolean;
  corsBlocked: boolean;
  everAttempted: boolean;
  sawHttpResponse: boolean;
  nxdomainProbes: DnsProbeOutcome[];
  dnssecBroken: DnsProbeOutcome | null;
  dnssecSigned: DnsProbeOutcome | null;
  lastNote: string | null;
}

export interface BenchmarkOptions {
  dnssec?: boolean;
  samplesPerMetric?: number;
  onProgress?: (stage: string, completed: number, total: number) => void;
  signal?: AbortSignal;
}

/** Builds the ordered list of (resolver index, kind, name) each slot will run. */
function buildSchedule(
  samplesPerMetric: number,
): { kind: DnsProbeKind; nameFor: (slot: number) => string }[] {
  const plan: { kind: DnsProbeKind; nameFor: (slot: number) => string }[] = [];
  for (let i = 0; i < samplesPerMetric; i++) {
    plan.push({ kind: 'cached', nameFor: (slot) => POPULAR_NAMES[slot % POPULAR_NAMES.length] });
  }
  for (let i = 0; i < samplesPerMetric; i++) {
    plan.push({
      kind: 'uncached',
      nameFor: (slot) => `${randomLabel(12)}.${POPULAR_NAMES[slot % POPULAR_NAMES.length]}`,
    });
  }
  for (let i = 0; i < samplesPerMetric; i++) {
    plan.push({ kind: 'dotcom', nameFor: () => `${randomLabel(16)}.com` });
  }
  return plan;
}

/**
 * Runs the benchmark.
 *
 * Scheduling is round-robin and strictly sequential: one request in flight at a
 * time, cycling resolvers between samples, with the starting resolver rotated
 * each round.
 *
 *   - One at a time, because concurrent requests share the same uplink and
 *     inflate each other in proportion to how many are running. A concurrent
 *     DNS benchmark measures the browser congesting itself. This is the
 *     condition GRC's introduction warns users about.
 *   - Cycling, because the dominant confound over a twenty-second window is a
 *     burst of other traffic; running one resolver's queries to completion
 *     before starting the next would land that burst entirely on one of them.
 *   - Rotating, because plain round-robin still puts the same resolver first in
 *     every round, handing it the coldest connection state each time.
 */
export async function runDnsBenchmark(
  options: BenchmarkOptions = {},
): Promise<DnsBenchmarkResult> {
  const {
    dnssec = true,
    samplesPerMetric = SAMPLES_PER_METRIC,
    onProgress,
    signal,
  } = options;
  const startedAt = performance.now();
  const id = createId('dnsbench');

  const blockedRows = (): ResolverBenchmark[] =>
    CORS_BLOCKED_RESOLVERS.map((blocked) => {
      const empty = toMetric([], 0);
      const classified = classifyResolver({
        label: blocked.label,
        cached: empty,
        uncached: empty,
        dotcom: empty,
        corsBlocked: true,
        everAttempted: false,
        sawHttpResponse: false,
      });
      return {
        resolverId: `blocked:${blocked.endpoint}`,
        label: blocked.label,
        operator: '',
        endpoint: blocked.endpoint,
        policyNote: '',
        cached: empty,
        uncached: empty,
        dotcom: empty,
        uncachedCostMs: null,
        nxdomainHonesty: 'inconclusive' as NxdomainHonesty,
        nxdomainDetail: 'Not checked — this endpoint cannot be queried from a browser.',
        dnssec: null,
        dnssecDetail: 'Not checked — this endpoint cannot be queried from a browser.',
        outcome: classified.outcome,
        note: classified.note,
      };
    });

  if (!navigator.onLine) {
    // Still list the reachable resolvers, marked as never tried. Dropping them
    // would leave the table showing only the ten a browser can never query,
    // which reads as though those were the whole field.
    const untried: ResolverBenchmark[] = DOH_RESOLVERS.map((resolver) => {
      const empty = toMetric([], 0);
      const classified = classifyResolver({
        label: resolver.label,
        cached: empty,
        uncached: empty,
        dotcom: empty,
        corsBlocked: false,
        everAttempted: false,
        sawHttpResponse: false,
      });
      return {
        resolverId: resolver.id,
        label: resolver.label,
        operator: resolver.operator,
        endpoint: resolver.endpoint,
        policyNote: resolver.policyNote,
        cached: empty,
        uncached: empty,
        dotcom: empty,
        uncachedCostMs: null,
        nxdomainHonesty: 'inconclusive' as NxdomainHonesty,
        nxdomainDetail: 'Not checked — the browser reports no network connection.',
        dnssec: null,
        dnssecDetail: 'Not checked — the browser reports no network connection.',
        outcome: classified.outcome,
        note: classified.note,
      };
    });

    return {
      id,
      timestamp: Date.now(),
      resolvers: [...untried, ...blockedRows()],
      samplesPerMetric,
      namesQueried: [],
      dnssecRequested: dnssec,
      phaseTimingsAvailable: null,
      fastestCachedResolverId: null,
      fastestIsWithinNoise: null,
      verdict: null,
      explanation:
        'The browser reports no network connection, so no resolver was queried and nothing was ' +
        'measured.',
      conclusions: [],
      totalTimeMs: 0,
      failures: [
        {
          metric: 'all',
          reason: 'network-offline',
          detail:
            'The browser reports no network connection. No DNS queries were sent, so every ' +
            'figure is absent rather than estimated.',
        },
      ],
    };
  }

  const states: ResolverState[] = DOH_RESOLVERS.map((resolver) => ({
    resolver,
    samples: { cached: [], uncached: [], dotcom: [] },
    attempts: { cached: 0, uncached: 0, dotcom: 0 },
    consecutiveFailures: 0,
    givenUp: false,
    corsBlocked: false,
    everAttempted: false,
    sawHttpResponse: false,
    nxdomainProbes: [],
    dnssecBroken: null,
    dnssecSigned: null,
    lastNote: null,
  }));

  const plan = buildSchedule(samplesPerMetric);
  const perResolverExtras = 2 + (dnssec ? 2 : 0); // NXDOMAIN pair, DNSSEC pair
  const total = states.length * (plan.length + perResolverExtras);
  let completed = 0;
  const tick = (stage: string) => {
    completed += 1;
    onProgress?.(stage, completed, total);
  };

  const record = async (
    state: ResolverState,
    kind: DnsProbeKind,
    name: string,
  ): Promise<void> => {
    state.attempts[kind] += 1;
    if (state.givenUp) return;

    state.everAttempted = true;
    const outcome = await queryResolver(
      state.resolver.endpoint,
      name,
      DNS_TYPE.A,
      { corsBlocked: state.corsBlocked },
      signal,
    );

    if (outcome.status === 'answered' && outcome.roundTripMs !== null) {
      state.samples[kind].push(outcome.roundTripMs);
      state.consecutiveFailures = 0;
      return;
    }

    state.lastNote = outcome.note;
    if (outcome.status === 'no-answer') state.sawHttpResponse = true;
    // Only a `TypeError` is ambiguous, and it is settled once per resolver
    // rather than by doubling every request in the run. An HTTP error is not
    // ambiguous: we read its status, so the browser was allowed to see it.
    if (
      !state.corsBlocked &&
      outcome.status === 'request-failed' &&
      state.consecutiveFailures === 0
    ) {
      state.corsBlocked = await probeIsCorsBlocked(state.resolver.endpoint, signal);
    }
    state.consecutiveFailures += 1;
    if (
      state.consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_GIVING_UP ||
      state.corsBlocked
    ) {
      state.givenUp = true;
    }
  };

  // Priming pass. The first request to a host pays DNS, TCP and TLS, and the
  // resolver may not hold the name yet. Its timing is discarded — and the UI
  // says so, because dropping samples without saying so is the same failure as
  // inventing them.
  for (let slot = 0; slot < POPULAR_NAMES.length; slot++) {
    for (let i = 0; i < states.length; i++) {
      if (signal?.aborted) break;
      const state = states[(i + slot) % states.length];
      if (state.givenUp) continue;
      state.everAttempted = true;
      const outcome = await queryResolver(
        state.resolver.endpoint,
        POPULAR_NAMES[slot],
        DNS_TYPE.A,
        { corsBlocked: state.corsBlocked },
        signal,
      );
      if (outcome.status !== 'answered') {
        state.lastNote = outcome.note;
        if (outcome.status === 'no-answer') state.sawHttpResponse = true;
        if (!state.corsBlocked && outcome.status === 'request-failed') {
          state.corsBlocked = await probeIsCorsBlocked(state.resolver.endpoint, signal);
          if (state.corsBlocked) state.givenUp = true;
        }
      }
    }
    onProgress?.('Warming up connections', 0, total);
  }

  for (let slot = 0; slot < plan.length && !signal?.aborted; slot++) {
    const step = plan[slot];
    for (let i = 0; i < states.length && !signal?.aborted; i++) {
      const state = states[(i + slot) % states.length];
      await record(state, step.kind, step.nameFor(slot));
      tick(`Measuring ${step.kind} lookups`);
    }
  }

  // NXDOMAIN honesty and DNSSEC. Two probes each, same round-robin discipline.
  for (let round = 0; round < 2 && !signal?.aborted; round++) {
    for (let i = 0; i < states.length && !signal?.aborted; i++) {
      const state = states[(i + round) % states.length];
      if (state.givenUp) {
        state.nxdomainProbes.push(notAttempted('Skipped: this resolver stopped answering.'));
      } else {
        state.nxdomainProbes.push(
          await queryResolver(
            state.resolver.endpoint,
            `${randomLabel(16)}.${randomLabel(8)}.com`,
            DNS_TYPE.A,
            { corsBlocked: state.corsBlocked },
            signal,
          ),
        );
      }
      tick('Checking behaviour for names that do not exist');
    }
  }

  if (dnssec) {
    for (const [index, name] of [DNSSEC_BROKEN_NAME, DNSSEC_SIGNED_NAME].entries()) {
      for (let i = 0; i < states.length && !signal?.aborted; i++) {
        const state = states[(i + index) % states.length];
        const outcome = state.givenUp
          ? notAttempted('Skipped: this resolver stopped answering.')
          : await queryResolver(
              state.resolver.endpoint,
              name,
              DNS_TYPE.A,
              { dnssecOk: true, corsBlocked: state.corsBlocked },
              signal,
            );
        if (index === 0) state.dnssecBroken = outcome;
        else state.dnssecSigned = outcome;
        tick('Checking DNSSEC validation');
      }
    }
  }

  const failures: MeasurementFailure[] = [];
  if (signal?.aborted) {
    failures.push({
      metric: 'all',
      reason: 'aborted',
      detail:
        'The run was stopped before it finished. Only the queries that completed are counted; ' +
        'the rest are absent rather than assumed.',
    });
  }

  const resolvers: ResolverBenchmark[] = states.map((state) => {
    const cached = toMetric(state.samples.cached, state.attempts.cached);
    const uncached = toMetric(state.samples.uncached, state.attempts.uncached);
    const dotcom = toMetric(state.samples.dotcom, state.attempts.dotcom);
    const classified = classifyResolver({
      label: state.resolver.label,
      cached,
      uncached,
      dotcom,
      corsBlocked: state.corsBlocked,
      everAttempted: state.everAttempted,
      sawHttpResponse: state.sawHttpResponse,
      lastNote: state.lastNote,
    });
    const nx = classifyNxdomain(state.nxdomainProbes);
    const sec =
      dnssec && state.dnssecBroken !== null && state.dnssecSigned !== null
        ? classifyDnssec(state.dnssecBroken, state.dnssecSigned)
        : null;

    if (classified.outcome === 'blocked-by-browser') {
      failures.push({
        metric: `${state.resolver.id}.all`,
        reason: 'cors-blocked',
        detail: classified.note,
      });
    } else if (classified.outcome === 'no-readable-answer') {
      failures.push({
        metric: `${state.resolver.id}.all`,
        reason: 'api-unreachable',
        detail: classified.note,
      });
    } else if (classified.outcome === 'partially-measured') {
      failures.push({
        metric: `${state.resolver.id}.samples`,
        reason: 'insufficient-samples',
        detail:
          `${state.resolver.label} did not answer at least ${MIN_SAMPLES_PER_METRIC} of every ` +
          'kind of query, so some of its figures are absent.',
      });
    }

    return {
      resolverId: state.resolver.id,
      label: state.resolver.label,
      operator: state.resolver.operator,
      endpoint: state.resolver.endpoint,
      policyNote: state.resolver.policyNote,
      cached,
      uncached,
      dotcom,
      uncachedCostMs: uncachedCost(cached, uncached),
      nxdomainHonesty: nx.honesty,
      nxdomainDetail: nx.detail,
      dnssec: sec === null ? null : sec.validation,
      dnssecDetail: sec === null ? 'DNSSEC checking was switched off for this run.' : sec.detail,
      outcome: classified.outcome,
      note: classified.note,
    };
  });

  const summary = summariseBenchmark(resolvers);

  return {
    id,
    timestamp: Date.now(),
    resolvers: [...resolvers, ...blockedRows()],
    samplesPerMetric,
    namesQueried: POPULAR_NAMES,
    dnssecRequested: dnssec,
    phaseTimingsAvailable: readPhaseAvailability(),
    fastestCachedResolverId: summary.fastestCachedResolverId,
    fastestIsWithinNoise: summary.fastestIsWithinNoise,
    verdict: summary.verdict,
    explanation: summary.explanation,
    conclusions: summary.conclusions,
    totalTimeMs: Math.round(performance.now() - startedAt),
    failures,
  };
}

/**
 * Whether the browser could read the connection phases of these requests.
 *
 * Checked rather than asserted. No DoH endpoint sends `Timing-Allow-Origin`
 * today, which is why the per-request timings here are wall clock only — but
 * that is a fact about current deployments, not a rule, so it is re-observed on
 * every run using the same reader the Edge Path Explorer uses.
 */
function readPhaseAvailability(): boolean | null {
  if (typeof performance.getEntriesByType !== 'function') return null;
  const hosts = DOH_RESOLVERS.map((r) => new URL(r.endpoint).origin);
  const entries = performance
    .getEntriesByType('resource')
    .filter((e): e is PerformanceResourceTiming => hosts.some((h) => e.name.startsWith(h)));
  if (entries.length === 0) return null;
  return entries.some((e) => readPhases(e).availability === 'available');
}
