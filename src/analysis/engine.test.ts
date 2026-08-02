import { describe, it, expect } from 'vitest';
import {
  buildVerdict,
  countConclusiveChecks,
  deriveSteps,
  evaluateRules,
  rankFindings,
  MIN_CHECKS_FOR_ALL_CLEAR,
} from './engine';
import { createSnapshot } from './snapshot';
import type { Finding, Rule, TriageSnapshot } from './types';
import type { DnsIntegrityResult, EdgePathResult, EdgeProbeResult, SpeedTestResult } from '../types';

const finding = (over: Partial<Finding>): Finding => ({
  ruleId: 'x',
  title: 'x',
  layer: 'isp',
  confidence: 'possible',
  severity: 'informational',
  verdict: 'v',
  remediation: ['r'],
  evidence: [],
  ...over,
});

const rule = (id: string, hit: boolean): Rule => ({
  id,
  title: id,
  layer: 'isp',
  consumes: ['browserOnline'],
  evaluate: () =>
    hit
      ? {
          confidence: 'confirmed',
          severity: 'degrading',
          verdict: `${id} fired`,
          remediation: ['do something'],
          evidence: [],
        }
      : null,
});

const workingDns = (): DnsIntegrityResult => ({
  id: 'dns',
  timestamp: 0,
  hostnameReachable: true,
  literalIpReachable: true,
  hostnameProbed: 'https://one.one.one.one/cdn-cgi/trace',
  literalProbed: 'https://1.1.1.1/cdn-cgi/trace',
  comparisons: [],
  verdict: 'resolver-working',
  explanation: 'names resolve',
  totalTimeMs: 10,
  failures: [],
});

const edgeWith = (availabilities: EdgeProbeResult['availability'][]): EdgePathResult => ({
  id: 'edge',
  timestamp: 0,
  targetHost: null,
  targetPop: null,
  referencePop: null,
  client: null,
  probes: availabilities.map(
    (availability, i) =>
      ({
        target: {
          label: `p${i}`,
          origin: `https://p${i}.test`,
          probeUrl: `https://p${i}.test/x`,
          expectsTao: true,
        },
        availability,
        phases: {
          dnsMs: null,
          tcpMs: null,
          tlsMs: null,
          ttfbMs: null,
          transferMs: null,
          totalMs: null,
        },
        protocol: null,
        roundTripMs: null,
        maxDistanceKm: null,
      }) as EdgeProbeResult,
  ),
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
});

const goodSpeed = (): SpeedTestResult => ({
  id: 'speed',
  timestamp: 0,
  downloadSpeed: 300,
  uploadSpeed: 100,
  ping: 12,
  jitter: 1,
  loadedPing: 15,
  bufferbloatScore: 'A+',
});

describe('evaluateRules', () => {
  it('runs every rule and keeps only the ones that fired', () => {
    const findings = evaluateRules(createSnapshot(), [rule('a', true), rule('b', false), rule('c', true)]);
    expect(findings.map((f) => f.ruleId)).toEqual(['a', 'c']);
  });

  it('carries the rule metadata onto the finding', () => {
    const [f] = evaluateRules(createSnapshot(), [rule('a', true)]);
    expect(f.title).toBe('a');
    expect(f.layer).toBe('isp');
  });
});

describe('rankFindings', () => {
  it('puts blocking above degrading regardless of confidence', () => {
    // A user chasing a dead connection is not helped by a confirmed note about
    // jitter sitting at the top of the list.
    const ranked = rankFindings([
      finding({ ruleId: 'jitter', severity: 'degrading', confidence: 'confirmed' }),
      finding({ ruleId: 'portal', severity: 'blocking', confidence: 'possible' }),
    ]);
    expect(ranked.map((f) => f.ruleId)).toEqual(['portal', 'jitter']);
  });

  it('breaks a severity tie on confidence', () => {
    const ranked = rankFindings([
      finding({ ruleId: 'maybe', severity: 'blocking', confidence: 'possible' }),
      finding({ ruleId: 'sure', severity: 'blocking', confidence: 'confirmed' }),
    ]);
    expect(ranked.map((f) => f.ruleId)).toEqual(['sure', 'maybe']);
  });

  it('is stable and does not mutate its input', () => {
    const input = [
      finding({ ruleId: 'b', severity: 'degrading', confidence: 'likely' }),
      finding({ ruleId: 'a', severity: 'degrading', confidence: 'likely' }),
    ];
    const rules = [rule('a', false), rule('b', false)];
    expect(rankFindings(input, rules).map((f) => f.ruleId)).toEqual(['a', 'b']);
    expect(input.map((f) => f.ruleId)).toEqual(['b', 'a']);
  });
});

describe('countConclusiveChecks', () => {
  it('counts nothing for an unmeasured snapshot', () => {
    expect(countConclusiveChecks(createSnapshot())).toBe(0);
  });

  it('counts a check only once it has a verdict', () => {
    const s: TriageSnapshot = createSnapshot({ dns: { ...workingDns(), verdict: null } });
    expect(countConclusiveChecks(s)).toBe(0);
    expect(countConclusiveChecks(createSnapshot({ dns: workingDns() }))).toBe(1);
  });

  it('counts a measured zero download as a result', () => {
    // The distinction between "0 Mbps" and "no figure" is the entire point.
    const s = createSnapshot({ speed: { ...goodSpeed(), downloadSpeed: 0 } });
    expect(countConclusiveChecks(s)).toBe(1);
  });
});

describe('buildVerdict', () => {
  const opts = { id: 'triage_1', now: 1000, totalTimeMs: 42 };

  it('refuses to declare a network healthy when almost nothing ran', () => {
    // This is the fabrication trap specific to this feature: silence from a
    // run that measured nothing must never read as a clean bill of health.
    const v = buildVerdict(createSnapshot(), opts);
    expect(v.attribution).toBe('indeterminate');
    expect(v.headline).toMatch(/Not enough was measured/);
    // The summary must decline in both directions rather than lean either way.
    expect(v.summary).toMatch(/Nothing here says the connection is fine/);
    expect(v.summary).toMatch(/nothing says it is broken/);
  });

  it('declares no fault only once enough independent checks have passed', () => {
    const s = createSnapshot({
      dns: workingDns(),
      dualStack: {
        id: 'ds',
        timestamp: 0,
        probes: [],
        ipv4Reachable: true,
        ipv6Reachable: true,
        preferredFamily: 'ipv6',
        preferredFamilySource: 'test',
        verdict: 'dual-stack',
        explanation: '',
        totalTimeMs: 0,
        failures: [],
      },
      edge: edgeWith(['available', 'available']),
      speed: goodSpeed(),
    });
    expect(countConclusiveChecks(s)).toBeGreaterThanOrEqual(MIN_CHECKS_FOR_ALL_CLEAR);
    const v = buildVerdict(s, opts);
    expect(v.findings).toEqual([]);
    expect(v.attribution).toBe('no-fault-found');
    // Even the clean verdict states its own limits.
    expect(v.summary).toMatch(/does not cover anything that was skipped/);
  });

  it('attributes the verdict to the layer of the top-ranked finding', () => {
    const v = buildVerdict(createSnapshot({ browserOnline: false }), opts);
    expect(v.attribution).toBe('this-device');
    expect(v.headline).toBe('It is this device.');
    expect(v.findings[0].ruleId).toBe('browser-offline');
  });

  it('is pure: identical input yields an identical verdict', () => {
    const s = createSnapshot({ speed: { ...goodSpeed(), ping: 10, loadedPing: 200 } });
    expect(JSON.stringify(buildVerdict(s, opts))).toBe(JSON.stringify(buildVerdict(s, opts)));
  });

  it('carries the supplied failures through untouched', () => {
    const failures = [
      { metric: 'bandwidth', reason: 'not-attempted' as const, detail: 'skipped deliberately' },
    ];
    expect(buildVerdict(createSnapshot(), { ...opts, failures }).failures).toEqual(failures);
  });
});

describe('deriveSteps', () => {
  it('produces every step even when nothing ran', () => {
    const steps = deriveSteps(createSnapshot());
    expect(steps).toHaveLength(8);
    // Not one of them may be left blank — blank reads as a pass.
    for (const s of steps) {
      expect(s.note, `${s.id} note`).toBeTruthy();
      expect(s.question.length, `${s.id} question`).toBeGreaterThan(0);
    }
  });

  it('marks unrun checks skipped rather than passed', () => {
    const byId = Object.fromEntries(deriveSteps(createSnapshot()).map((s) => [s.id, s]));
    expect(byId['dns'].status).toBe('skipped');
    expect(byId['captive-portal'].status).toBe('skipped');
    expect(byId['bandwidth'].status).toBe('skipped');
    expect(byId['bufferbloat'].status).toBe('skipped');
  });

  it('always skips the gateway step and explains why a browser cannot do it', () => {
    const step = deriveSteps(createSnapshot()).find((s) => s.id === 'lan-gateway')!;
    expect(step.status).toBe('skipped');
    expect(step.note).toMatch(/mDNS|gateway address/);
  });

  it('reports an unmeasurable throughput as inconclusive, never as zero', () => {
    const s = createSnapshot({ speed: { ...goodSpeed(), downloadSpeed: null } });
    const step = deriveSteps(s).find((st) => st.id === 'bandwidth')!;
    expect(step.status).toBe('inconclusive');
    expect(step.note).toMatch(/not a figure of zero/);
  });

  it('shows a measured zero as a measurement', () => {
    const s = createSnapshot({ speed: { ...goodSpeed(), downloadSpeed: 0, uploadSpeed: null } });
    const step = deriveSteps(s).find((st) => st.id === 'bandwidth')!;
    expect(step.status).toBe('pass');
    expect(step.note).toBe('0 Mbps down.');
  });

  it('grades the CDN step by how many providers answered', () => {
    const at = (avail: EdgeProbeResult['availability'][]) =>
      deriveSteps(createSnapshot({ edge: edgeWith(avail) })).find((s) => s.id === 'cdn-reach')!;
    expect(at(['available', 'available']).status).toBe('pass');
    expect(at(['available', 'request-failed']).status).toBe('inconclusive');
    expect(at(['request-failed', 'request-failed']).status).toBe('fail');
  });

  it('fails the bufferbloat step at the threshold and passes below it', () => {
    const at = (loaded: number) =>
      deriveSteps(createSnapshot({ speed: { ...goodSpeed(), ping: 20, loadedPing: loaded } })).find(
        (s) => s.id === 'bufferbloat',
      )!;
    expect(at(70).status).toBe('fail');
    expect(at(69).status).toBe('pass');
  });

  it('is inconclusive about bufferbloat when one sample is missing', () => {
    const step = deriveSteps(
      createSnapshot({ speed: { ...goodSpeed(), ping: 20, loadedPing: null } }),
    ).find((s) => s.id === 'bufferbloat')!;
    expect(step.status).toBe('inconclusive');
    expect(step.note).toMatch(/one of them is missing/);
  });
});
