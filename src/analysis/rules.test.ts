import { describe, it, expect } from 'vitest';
import { RULES, THRESHOLDS } from './rules';
import { evaluateRules } from './engine';
import { createSnapshot } from './snapshot';
import type {
  CaptivePortalResult,
  DnsIntegrityResult,
  DualStackResult,
  EdgePathResult,
  EdgeProbeResult,
  PingResult,
  SpeedTestResult,
} from '../types';
import type { TriageSnapshot } from './types';

// --- builders ---------------------------------------------------------------
// Deliberately minimal: each returns a record with everything null except the
// fields a test sets. A builder that filled in plausible defaults would let a
// rule pass a test while reading an input the run never measured.

const dns = (over: Partial<DnsIntegrityResult> = {}): DnsIntegrityResult => ({
  id: 'dns',
  timestamp: 0,
  hostnameReachable: null,
  literalIpReachable: null,
  hostnameProbed: 'https://one.one.one.one/cdn-cgi/trace',
  literalProbed: 'https://1.1.1.1/cdn-cgi/trace',
  comparisons: [],
  verdict: null,
  explanation: '',
  totalTimeMs: 0,
  failures: [],
  ...over,
});

const portal = (over: Partial<CaptivePortalResult> = {}): CaptivePortalResult => ({
  id: 'portal',
  timestamp: 0,
  pageProtocol: 'https:',
  probes: [],
  verdict: null,
  explanation: '',
  totalTimeMs: 0,
  failures: [],
  ...over,
});

const dualStack = (over: Partial<DualStackResult> = {}): DualStackResult => ({
  id: 'ds',
  timestamp: 0,
  probes: [],
  ipv4Reachable: null,
  ipv6Reachable: null,
  preferredFamily: null,
  preferredFamilySource: null,
  verdict: null,
  explanation: '',
  totalTimeMs: 0,
  failures: [],
  ...over,
});

const edgeProbe = (label: string, availability: EdgeProbeResult['availability']): EdgeProbeResult =>
  ({
    target: { label, origin: `https://${label}.test`, probeUrl: `https://${label}.test/x`, expectsTao: true },
    availability,
    phases: { dnsMs: null, tcpMs: null, tlsMs: null, ttfbMs: null, transferMs: null, totalMs: null },
    protocol: null,
    roundTripMs: null,
    maxDistanceKm: null,
  }) as EdgeProbeResult;

const edge = (over: Partial<EdgePathResult> = {}): EdgePathResult => ({
  id: 'edge',
  timestamp: 0,
  targetHost: null,
  targetPop: null,
  referencePop: null,
  client: null,
  probes: [],
  protocolEvidence: {
    negotiated: [],
    h3Count: 0,
    h2Count: 0,
    http1Count: 0,
    verdict: null,
    explanation: '',
  },
  clientToPopKm: null,
  totalTimeMs: 0,
  failures: [],
  ...over,
});

const speed = (over: Partial<SpeedTestResult> = {}): SpeedTestResult => ({
  id: 'speed',
  timestamp: 0,
  downloadSpeed: null,
  uploadSpeed: null,
  ping: null,
  jitter: null,
  loadedPing: null,
  bufferbloatScore: null,
  ...over,
});

const ping = (over: Partial<PingResult> = {}): PingResult => ({
  id: 'ping',
  timestamp: 0,
  target: 'https://1.1.1.1/cdn-cgi/trace',
  label: 'Cloudflare',
  packetsSent: 0,
  packetsReceived: 0,
  packetLoss: 0,
  minPing: null,
  maxPing: null,
  avgPing: null,
  jitter: null,
  points: [],
  ...over,
});

const fired = (snapshot: TriageSnapshot): string[] =>
  evaluateRules(snapshot).map((f) => f.ruleId);

// --- the rule that matters most --------------------------------------------

describe('an empty snapshot', () => {
  it('fires no rule at all', () => {
    // This is the single most important assertion in the answer layer. A
    // diagnostic that produces conclusions from nothing is exactly the failure
    // this codebase was rebuilt to remove — a machine with no measurements must
    // yield no findings, not a reassuring one and not an alarming one.
    expect(fired(createSnapshot())).toEqual([]);
  });

  it('fires no rule when every probe ran and returned nothing measurable', () => {
    const s = createSnapshot({
      dns: dns(),
      portal: portal(),
      dualStack: dualStack(),
      edge: edge(),
      speed: speed(),
      ping: ping(),
    });
    expect(fired(s)).toEqual([]);
  });
});

describe('browser-offline', () => {
  it('fires when the browser reports no link', () => {
    const findings = evaluateRules(createSnapshot({ browserOnline: false }));
    expect(findings.map((f) => f.ruleId)).toEqual(['browser-offline']);
    expect(findings[0].confidence).toBe('confirmed');
    expect(findings[0].layer).toBe('this-device');
  });

  it('stays quiet when the browser has a link', () => {
    expect(fired(createSnapshot({ browserOnline: true }))).not.toContain('browser-offline');
  });
});

describe('dns rules', () => {
  it('fires resolver-failing on the hostname/literal split', () => {
    const s = createSnapshot({
      dns: dns({ verdict: 'resolver-failing', hostnameReachable: false, literalIpReachable: true }),
    });
    expect(fired(s)).toContain('dns-resolver-failing');
  });

  it('stays quiet when the resolver works', () => {
    const s = createSnapshot({ dns: dns({ verdict: 'resolver-working', hostnameReachable: true }) });
    expect(fired(s)).toEqual([]);
  });

  it('fires divergence only when a comparison actually disagreed', () => {
    const withDisagreement = createSnapshot({
      dns: dns({
        verdict: 'answers-diverge',
        comparisons: [{ name: 'dns.google', cloudflare: ['8.8.8.8'], google: ['203.0.113.1'], agrees: false }],
      }),
    });
    expect(fired(withDisagreement)).toContain('dns-answers-diverge');

    // A verdict with no disagreeing comparison behind it must not produce a
    // finding; the evidence is the finding.
    const withoutEvidence = createSnapshot({
      dns: dns({ verdict: 'answers-diverge', comparisons: [] }),
    });
    expect(fired(withoutEvidence)).toEqual([]);
  });
});

describe('interception rules', () => {
  it('fires content-substituted and cites the mismatching probe', () => {
    const s = createSnapshot({
      portal: portal({
        verdict: 'content-substituted',
        probes: [
          {
            label: 'Cloudflare edge metadata',
            url: 'https://speed.cloudflare.com/meta',
            expectation: 'JSON',
            outcome: 'content-mismatch',
            roundTripMs: 20,
            note: 'returned an HTML sign-in page',
          },
        ],
      }),
    });
    const finding = evaluateRules(s).find((f) => f.ruleId === 'https-content-substituted');
    expect(finding).toBeDefined();
    expect(finding!.evidence[0].observation).toContain('sign-in page');
  });

  it('fires https-blocked only while the browser claims to be online', () => {
    const online = createSnapshot({ browserOnline: true, portal: portal({ verdict: 'https-blocked' }) });
    expect(fired(online)).toContain('https-blocked');

    // Offline, the portal rule must yield to the offline rule rather than add
    // a second, wrong explanation for the same silence.
    const offline = createSnapshot({ browserOnline: false, portal: portal({ verdict: 'https-blocked' }) });
    expect(fired(offline)).toEqual(['browser-offline']);
  });
});

describe('cdn reachability rules', () => {
  it('fires all-cdns-unreachable only when every provider failed', () => {
    const all = createSnapshot({
      edge: edge({
        probes: [
          edgeProbe('a', 'request-failed'),
          edgeProbe('b', 'request-failed'),
          edgeProbe('c', 'request-failed'),
        ],
      }),
    });
    expect(fired(all)).toContain('all-cdns-unreachable');
    expect(fired(all)).not.toContain('one-cdn-unreachable');
  });

  it('fires one-cdn-unreachable for a partial failure and blames the destination', () => {
    const s = createSnapshot({
      edge: edge({ probes: [edgeProbe('a', 'request-failed'), edgeProbe('b', 'available')] }),
    });
    const finding = evaluateRules(s).find((f) => f.ruleId === 'one-cdn-unreachable');
    expect(finding).toBeDefined();
    expect(finding!.layer).toBe('destination');
    expect(fired(s)).not.toContain('all-cdns-unreachable');
  });

  it('stays quiet when every provider answered', () => {
    const s = createSnapshot({
      edge: edge({ probes: [edgeProbe('a', 'available'), edgeProbe('b', 'connection-reused')] }),
    });
    expect(fired(s)).toEqual([]);
  });

  it('does not blame the network for unreachable providers while offline', () => {
    const s = createSnapshot({
      browserOnline: false,
      edge: edge({ probes: [edgeProbe('a', 'request-failed'), edgeProbe('b', 'request-failed')] }),
    });
    expect(fired(s)).toEqual(['browser-offline']);
  });
});

describe('protocol rules', () => {
  it('fires on HTTP/3 falling back to HTTP/2', () => {
    const s = createSnapshot({
      edge: edge({
        protocolEvidence: {
          negotiated: ['h2'],
          h3Count: 0,
          h2Count: 4,
          http1Count: 0,
          verdict: 'http3-absent-udp-possibly-blocked',
          explanation: '',
        },
      }),
    });
    expect(fired(s)).toContain('udp-443-blocked');
  });

  it('fires on a total fallback to HTTP/1.1', () => {
    const s = createSnapshot({
      edge: edge({
        protocolEvidence: {
          negotiated: ['http/1.1'],
          h3Count: 0,
          h2Count: 0,
          http1Count: 3,
          verdict: 'legacy-http1',
          explanation: '',
        },
      }),
    });
    expect(fired(s)).toContain('legacy-http1');
  });

  it('stays quiet when HTTP/3 works', () => {
    const s = createSnapshot({
      edge: edge({
        protocolEvidence: {
          negotiated: ['h3'],
          h3Count: 3,
          h2Count: 0,
          http1Count: 0,
          verdict: 'http3-working',
          explanation: '',
        },
      }),
    });
    expect(fired(s)).toEqual([]);
  });
});

describe('bufferbloat', () => {
  it('fires at the threshold and not below it', () => {
    const at = createSnapshot({
      speed: speed({ ping: 20, loadedPing: 20 + THRESHOLDS.bufferbloatDeltaMs }),
    });
    expect(fired(at)).toContain('bufferbloat');

    const below = createSnapshot({
      speed: speed({ ping: 20, loadedPing: 20 + THRESHOLDS.bufferbloatDeltaMs - 1 }),
    });
    expect(fired(below)).not.toContain('bufferbloat');
  });

  it('needs both samples and will not derive one from the other', () => {
    // The original codebase reported `loadedPing = ping + 14` when the loaded
    // sample failed, and then graded bufferbloat from it.
    expect(fired(createSnapshot({ speed: speed({ ping: 20, loadedPing: null }) }))).toEqual([]);
    expect(fired(createSnapshot({ speed: speed({ ping: null, loadedPing: 200 }) }))).toEqual([]);
  });

  it('quotes both measured latencies as evidence', () => {
    const s = createSnapshot({ speed: speed({ ping: 18, loadedPing: 80 }) });
    const finding = evaluateRules(s).find((f) => f.ruleId === 'bufferbloat')!;
    expect(finding.verdict).toContain('18 ms');
    expect(finding.verdict).toContain('80 ms');
    expect(finding.evidence).toHaveLength(2);
  });
});

describe('packet loss', () => {
  it('fires above the threshold with enough packets', () => {
    const s = createSnapshot({
      ping: ping({ packetsSent: 10, packetsReceived: 8, packetLoss: 20 }),
    });
    expect(fired(s)).toContain('packet-loss');
  });

  it('refuses to report loss from too few packets', () => {
    // 1 of 2 lost is 50% and means nothing.
    const s = createSnapshot({ ping: ping({ packetsSent: 2, packetsReceived: 1, packetLoss: 50 }) });
    expect(fired(s)).not.toContain('packet-loss');
  });

  it('stays quiet at zero loss', () => {
    const s = createSnapshot({
      ping: ping({ packetsSent: 10, packetsReceived: 10, packetLoss: 0, avgPing: 20, jitter: 2 }),
    });
    expect(fired(s)).toEqual([]);
  });
});

describe('latency, jitter and bandwidth rules', () => {
  it('fires high-latency from either latency source', () => {
    expect(fired(createSnapshot({ ping: ping({ avgPing: THRESHOLDS.highLatencyMs }) }))).toContain(
      'high-latency',
    );
    expect(fired(createSnapshot({ speed: speed({ ping: 400 }) }))).toContain('high-latency');
  });

  it('prefers the dedicated ping run over the speed test samples', () => {
    const s = createSnapshot({
      ping: ping({ avgPing: 20 }),
      speed: speed({ ping: 400 }),
    });
    expect(fired(s)).not.toContain('high-latency');
  });

  it('fires high-jitter above the threshold only', () => {
    expect(fired(createSnapshot({ ping: ping({ jitter: THRESHOLDS.highJitterMs }) }))).toContain(
      'high-jitter',
    );
    expect(
      fired(createSnapshot({ ping: ping({ jitter: THRESHOLDS.highJitterMs - 1 }) })),
    ).not.toContain('high-jitter');
  });

  it('fires low-download below the threshold', () => {
    expect(fired(createSnapshot({ speed: speed({ downloadSpeed: 4 }) }))).toContain('low-download');
    expect(
      fired(createSnapshot({ speed: speed({ downloadSpeed: THRESHOLDS.lowDownloadMbps }) })),
    ).not.toContain('low-download');
  });

  it('treats a measured zero as a real measurement, not as absence', () => {
    // `||` in place of `??` here would rewrite a genuine 0 Mbps into "not
    // measured" and suppress the finding entirely.
    const s = createSnapshot({ speed: speed({ downloadSpeed: 0 }) });
    expect(fired(s)).toContain('low-download');
  });

  it('says nothing about bandwidth that was not measured', () => {
    expect(fired(createSnapshot({ speed: speed({ downloadSpeed: null }) }))).toEqual([]);
  });
});

describe('dual-stack rule', () => {
  it('fires only on an IPv4-only verdict, and only as informational', () => {
    const s = createSnapshot({ dualStack: dualStack({ verdict: 'ipv4-only' }) });
    const finding = evaluateRules(s).find((f) => f.ruleId === 'no-ipv6')!;
    expect(finding.severity).toBe('informational');
    expect(finding.confidence).toBe('possible');
  });

  it('stays quiet on dual-stack and on a total failure', () => {
    expect(fired(createSnapshot({ dualStack: dualStack({ verdict: 'dual-stack' }) }))).toEqual([]);
    expect(
      fired(createSnapshot({ dualStack: dualStack({ verdict: 'neither-family-answered' }) })),
    ).toEqual([]);
  });
});

describe('the rule table itself', () => {
  it('has unique ids', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it('declares what every rule consumes', () => {
    for (const rule of RULES) {
      expect(rule.consumes.length, `${rule.id} consumes`).toBeGreaterThan(0);
      expect(rule.title.length, `${rule.id} title`).toBeGreaterThan(0);
    }
  });

  it('gives every rule at least one concrete remediation when it fires', () => {
    // A finding with no action attached is a complaint, not a diagnosis.
    const everything = createSnapshot({
      browserOnline: false,
      dns: dns({
        verdict: 'resolver-failing',
        hostnameReachable: false,
        literalIpReachable: true,
      }),
      portal: portal({ verdict: 'content-substituted', probes: [] }),
      dualStack: dualStack({ verdict: 'ipv4-only' }),
      speed: speed({ ping: 10, loadedPing: 300, downloadSpeed: 1 }),
      ping: ping({ packetsSent: 10, packetsReceived: 5, packetLoss: 50, avgPing: 400, jitter: 90 }),
    });
    const findings = evaluateRules(everything);
    expect(findings.length).toBeGreaterThan(3);
    for (const f of findings) {
      expect(f.remediation.length, `${f.ruleId} remediation`).toBeGreaterThan(0);
      expect(f.verdict.length, `${f.ruleId} verdict`).toBeGreaterThan(0);
    }
  });

  it('cites evidence whose metric matches something the rule declared', () => {
    const s = createSnapshot({
      speed: speed({ ping: 10, loadedPing: 300, downloadSpeed: 1 }),
      ping: ping({ packetsSent: 10, packetsReceived: 5, packetLoss: 50, avgPing: 400, jitter: 90 }),
    });
    for (const finding of evaluateRules(s)) {
      const rule = RULES.find((r) => r.id === finding.ruleId)!;
      for (const e of finding.evidence) {
        expect(
          rule.consumes.some((c) => c === e.metric || c.startsWith(e.metric) || e.metric.startsWith(c)),
          `${finding.ruleId} cites ${e.metric}, which it does not declare`,
        ).toBe(true);
      }
    }
  });
});
