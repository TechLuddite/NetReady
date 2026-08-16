import { describe, it, expect } from 'vitest';
import {
  CORS_BLOCKED_RESOLVERS,
  DOH_RESOLVERS,
  classifyDnssec,
  classifyNxdomain,
  classifyResolver,
  summariseBenchmark,
  uncachedCost,
  type DnsProbeOutcome,
} from './dnsBenchmark';
import { DNS_TYPE, type DnsMessage } from './dnsWire';
import type { DnsMetricSummary, ResolverBenchmark } from '../types';

const message = (over: {
  rcode?: number;
  ad?: boolean;
  addresses?: number;
} = {}): DnsMessage => {
  const { rcode = 0, ad = false, addresses = 0 } = over;
  return {
    header: {
      id: 1,
      qr: true,
      opcode: 0,
      aa: false,
      tc: false,
      rd: true,
      ra: true,
      ad,
      cd: false,
      rcode,
      qdcount: 1,
      ancount: addresses,
      nscount: 0,
      arcount: 0,
    },
    question: { name: 'x.example', qtype: 1, qclass: 1 },
    answers: Array.from({ length: addresses }, () => ({
      name: 'x.example',
      type: DNS_TYPE.A,
      class: 1,
      ttl: 60,
      data: '203.0.113.1',
    })),
  };
};

const answered = (msg: DnsMessage): DnsProbeOutcome => ({
  roundTripMs: 20,
  message: msg,
  status: 'answered',
  note: null,
});

const silent = (): DnsProbeOutcome => ({
  roundTripMs: null,
  message: null,
  status: 'no-answer',
  note: 'nothing came back',
});

const metric = (over: Partial<DnsMetricSummary> = {}): DnsMetricSummary => ({
  answered: 5,
  attempted: 5,
  medianMs: 20,
  p95Ms: null,
  minMs: 18,
  maxMs: 24,
  stdDevMs: 2,
  ...over,
});

const emptyMetric = (): DnsMetricSummary => ({
  answered: 0,
  attempted: 5,
  medianMs: null,
  p95Ms: null,
  minMs: null,
  maxMs: null,
  stdDevMs: null,
});

const row = (over: Partial<ResolverBenchmark> = {}): ResolverBenchmark => ({
  resolverId: 'r',
  label: 'Resolver',
  operator: 'Operator',
  endpoint: 'https://example.test/dns-query',
  policyNote: '',
  cached: metric(),
  uncached: metric({ medianMs: 60, minMs: 55, maxMs: 70 }),
  dotcom: metric({ medianMs: 70, minMs: 65, maxMs: 80 }),
  uncachedCostMs: 40,
  nxdomainHonesty: 'honest',
  nxdomainDetail: '',
  dnssec: 'validates',
  dnssecDetail: '',
  outcome: 'measured',
  note: '',
  ...over,
});

describe('the resolver catalogue', () => {
  it('has unique ids and reaches every endpoint over https', () => {
    const ids = DOH_RESOLVERS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of DOH_RESOLVERS) {
      expect(r.endpoint.startsWith('https://')).toBe(true);
      expect(r.operator.length).toBeGreaterThan(0);
    }
  });

  it('names the resolvers a browser cannot reach, rather than omitting them', () => {
    // A short list that does not say why it is short reads as a complete one.
    expect(CORS_BLOCKED_RESOLVERS.length).toBeGreaterThan(0);
    const blockedEndpoints = new Set(CORS_BLOCKED_RESOLVERS.map((r) => r.endpoint));
    for (const r of DOH_RESOLVERS) expect(blockedEndpoints.has(r.endpoint)).toBe(false);
  });
});

describe('classifyNxdomain', () => {
  it('says nothing when nothing came back', () => {
    // A resolver that did not answer has not demonstrated honesty.
    expect(classifyNxdomain([]).honesty).toBe('inconclusive');
    expect(classifyNxdomain([silent(), silent()]).honesty).toBe('inconclusive');
  });

  it('calls NXDOMAIN for a name that does not exist honest', () => {
    const result = classifyNxdomain([
      answered(message({ rcode: 3 })),
      answered(message({ rcode: 3 })),
    ]);
    expect(result.honesty).toBe('honest');
  });

  it('flags a resolver only when both made-up names got an address', () => {
    const both = classifyNxdomain([
      answered(message({ rcode: 0, addresses: 1 })),
      answered(message({ rcode: 0, addresses: 2 })),
    ]);
    expect(both.honesty).toBe('answers-with-an-address');
    // The wording must describe the observation, not assert a motive.
    expect(both.detail).toContain('not the reason for it');
  });

  it('stays inconclusive when only one made-up name got an address', () => {
    // One is within the noise of a parked wildcard, and the accusation is
    // specific enough to be worth being sure about.
    const mixed = classifyNxdomain([
      answered(message({ rcode: 0, addresses: 1 })),
      answered(message({ rcode: 3 })),
    ]);
    expect(mixed.honesty).toBe('inconclusive');
  });

  it('does not treat SERVFAIL as honesty', () => {
    const result = classifyNxdomain([
      answered(message({ rcode: 2 })),
      answered(message({ rcode: 2 })),
    ]);
    expect(result.honesty).toBe('inconclusive');
    expect(result.detail).toContain('SERVFAIL');
  });

  it('needs two probes before claiming an address was returned', () => {
    const single = classifyNxdomain([answered(message({ rcode: 0, addresses: 1 }))]);
    expect(single.honesty).toBe('inconclusive');
  });
});

describe('classifyDnssec', () => {
  const brokenRefused = answered(message({ rcode: 2 }));
  const brokenServed = answered(message({ rcode: 0, addresses: 1 }));
  const signedAuthentic = answered(message({ rcode: 0, ad: true, addresses: 1 }));
  const signedPlain = answered(message({ rcode: 0, ad: false, addresses: 1 }));

  it('requires both signals to agree before claiming validation', () => {
    expect(classifyDnssec(brokenRefused, signedAuthentic).validation).toBe('validates');
    expect(classifyDnssec(brokenServed, signedPlain).validation).toBe('does-not-validate');
  });

  it('reports disagreement as inconclusive rather than resolving it', () => {
    // A resolver simply broken for one name also SERVFAILs, and a resolver can
    // set AD without ever refusing a broken chain. Neither half stands alone.
    expect(classifyDnssec(brokenRefused, signedPlain).validation).toBe('inconclusive');
    expect(classifyDnssec(brokenServed, signedAuthentic).validation).toBe('inconclusive');
  });

  it('is inconclusive when either probe produced nothing', () => {
    expect(classifyDnssec(silent(), signedAuthentic).validation).toBe('inconclusive');
    expect(classifyDnssec(brokenRefused, silent()).validation).toBe('inconclusive');
  });

  it('describes the AD bit as a claim, not as proof', () => {
    const detail = classifyDnssec(brokenRefused, signedAuthentic).detail;
    expect(detail).toContain('own claim');
  });
});

describe('classifyResolver', () => {
  const base = {
    label: 'Resolver',
    cached: metric(),
    uncached: metric(),
    dotcom: metric(),
    corsBlocked: false,
    everAttempted: true,
    sawHttpResponse: false,
  };

  it('reports a CORS block as a browser limitation, not a resolver result', () => {
    const r = classifyResolver({ ...base, corsBlocked: true });
    expect(r.outcome).toBe('blocked-by-browser');
    expect(r.note).toContain('not a measurement of the resolver');
  });

  it('distinguishes "never asked" from "asked and got nothing"', () => {
    expect(classifyResolver({ ...base, everAttempted: false }).outcome).toBe('not-attempted');
    const nothing = classifyResolver({
      ...base,
      cached: emptyMetric(),
      uncached: emptyMetric(),
      dotcom: emptyMetric(),
    });
    expect(nothing.outcome).toBe('no-readable-answer');
  });

  it('refuses to blame the resolver for an ambiguous failure', () => {
    const nothing = classifyResolver({
      ...base,
      cached: emptyMetric(),
      uncached: emptyMetric(),
      dotcom: emptyMetric(),
    });
    expect(nothing.note).toContain('both fail identically');
  });

  it('does not claim a browser limitation when the resolver plainly replied', () => {
    // A live run caught this: a resolver returning HTTP 505 was reported as
    // "does not send the header that lets a web page read its answers". Reading
    // a status code at all proves the browser was allowed to see the response,
    // so that note asserted something the reply itself disproved.
    const errored = classifyResolver({
      ...base,
      cached: emptyMetric(),
      uncached: emptyMetric(),
      dotcom: emptyMetric(),
      sawHttpResponse: true,
      lastNote: 'The resolver declined the query with HTTP 505.',
    });
    expect(errored.outcome).toBe('no-readable-answer');
    expect(errored.note).toContain('replied, but never with a usable DNS answer');
    expect(errored.note).toContain('505');
    expect(errored.note).not.toContain('does not send the header');
    expect(errored.note).not.toContain('blocked it');
  });

  it('marks a resolver partial when only some metrics have enough samples', () => {
    const partial = classifyResolver({ ...base, dotcom: metric({ answered: 1, medianMs: null }) });
    expect(partial.outcome).toBe('partially-measured');
  });

  it('marks a resolver measured when every metric produced a median', () => {
    expect(classifyResolver(base).outcome).toBe('measured');
  });
});

describe('uncachedCost', () => {
  it('is null when either median is missing', () => {
    expect(uncachedCost(metric({ medianMs: null }), metric())).toBeNull();
    expect(uncachedCost(metric(), metric({ medianMs: null }))).toBeNull();
  });

  it('preserves a negative difference instead of clamping it to zero', () => {
    // A "cached" name whose TTL had expired at that anycast node produces
    // exactly this. Clamping would substitute a value for a measurement.
    expect(uncachedCost(metric({ medianMs: 30 }), metric({ medianMs: 26 }))).toBe(-4);
  });

  it('preserves a genuine zero', () => {
    expect(uncachedCost(metric({ medianMs: 30 }), metric({ medianMs: 30 }))).toBe(0);
  });
});

describe('summariseBenchmark', () => {
  it('produces no verdict and no conclusions from nothing', () => {
    // The engine's empty-snapshot test, for this tool. Silence must not read as
    // a clean bill of health.
    const s = summariseBenchmark([]);
    expect(s.verdict).toBeNull();
    expect(s.conclusions).toEqual([]);
    expect(s.fastestCachedResolverId).toBeNull();
  });

  it('declines to rank when every resolver failed', () => {
    const dead = row({
      cached: emptyMetric(),
      uncached: emptyMetric(),
      dotcom: emptyMetric(),
      outcome: 'no-readable-answer',
    });
    const s = summariseBenchmark([dead]);
    expect(s.verdict).toBe('nothing-measured');
    expect(s.fastestCachedResolverId).toBeNull();
    expect(s.conclusions).toEqual([]);
  });

  it('does not call a single result a ranking', () => {
    const s = summariseBenchmark([row({ resolverId: 'only' })]);
    expect(s.fastestCachedResolverId).toBe('only');
    expect(s.fastestIsWithinNoise).toBeNull();
    expect(s.conclusions[0]).toContain('not a ranking');
  });

  it('declares a winner only when the observed ranges do not overlap', () => {
    const fast = row({
      resolverId: 'fast',
      label: 'Fast',
      cached: metric({ medianMs: 10, minMs: 8, maxMs: 12 }),
    });
    const slow = row({
      resolverId: 'slow',
      label: 'Slow',
      cached: metric({ medianMs: 90, minMs: 85, maxMs: 95 }),
    });
    const s = summariseBenchmark([slow, fast]);
    expect(s.fastestCachedResolverId).toBe('fast');
    expect(s.fastestIsWithinNoise).toBe(false);
    expect(s.conclusions[0]).toContain('clear of');
  });

  it('says two resolvers are indistinguishable when their ranges overlap', () => {
    // The replacement for a significance claim: a statement about the intervals
    // that were actually observed, not a p-value with no basis.
    const a = row({ resolverId: 'a', label: 'A', cached: metric({ medianMs: 20, minMs: 15, maxMs: 40 }) });
    const b = row({ resolverId: 'b', label: 'B', cached: metric({ medianMs: 22, minMs: 16, maxMs: 44 }) });
    const s = summariseBenchmark([a, b]);
    expect(s.fastestIsWithinNoise).toBe(true);
    expect(s.conclusions[0]).toContain('does not separate them');
  });

  it('always states that the user’s own resolver is not in the table', () => {
    const s = summariseBenchmark([row(), row({ resolverId: 'b' })]);
    expect(s.conclusions[s.conclusions.length - 1]).toContain(
      'describes the resolver your device is actually using',
    );
  });

  it('reports a resolver that answers made-up names with an address', () => {
    const liar = row({ resolverId: 'liar', label: 'Liar', nxdomainHonesty: 'answers-with-an-address' });
    const s = summariseBenchmark([row(), liar]);
    expect(s.conclusions.join(' ')).toContain('Liar');
    expect(s.conclusions.join(' ')).toContain('do not exist');
  });

  it('does not let a browser-blocked resolver drag the verdict to partial', () => {
    const blocked = row({
      resolverId: 'blocked',
      outcome: 'blocked-by-browser',
      cached: emptyMetric(),
      uncached: emptyMetric(),
      dotcom: emptyMetric(),
    });
    const s = summariseBenchmark([row(), blocked]);
    expect(s.verdict).toBe('measured');
  });
});
