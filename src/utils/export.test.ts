import { describe, it, expect } from 'vitest';
import {
  escapeCsv,
  getCsvForType,
  generateSpeedtestCsv,
  generatePingCsv,
  generateGeoIpCsv,
  generateTriageCsv,
  generateDualStackCsv,
  generateCaptivePortalCsv,
  generateDnsBenchmarkCsv,
  generateWalkTestCsv,
  TEST_TYPES,
} from './export';
import type { HistoryItem } from '../types';

/**
 * These are the regression tests for the export pipeline.
 *
 * Every generator here read at least one field name that did not exist on the
 * record it was formatting, and because `HistoryItem.data` was `any`, tsc could
 * not see it. The result was a structurally valid CSV with no data in it — a
 * silent failure that survived to production.
 */

const speedItem: HistoryItem = {
  id: 'speed_1',
  type: 'speedtest',
  timestamp: 1_700_000_000_000,
  title: 'Speed Test',
  summary: 'summary',
  data: {
    id: 'speed_1',
    timestamp: 1_700_000_000_000,
    downloadSpeed: 94.5,
    uploadSpeed: 12.25,
    ping: 14,
    jitter: 3,
    loadedPing: 61,
    bufferbloatScore: 'C',
    serverName: 'Cloudflare Global Edge CDN',
    totalBytesDownloaded: 58.2,
    totalBytesUploaded: 8.4,
  },
};

const pingItem: HistoryItem = {
  id: 'ping_1',
  type: 'ping',
  timestamp: 1_700_000_000_000,
  title: 'Ping',
  summary: 'summary',
  data: {
    id: 'ping_1',
    timestamp: 1_700_000_000_000,
    target: 'https://1.1.1.1/cdn-cgi/trace',
    label: 'Cloudflare',
    packetsSent: 15,
    packetsReceived: 14,
    packetLoss: 7,
    minPing: 11,
    maxPing: 48,
    avgPing: 19,
    jitter: 4,
    points: [],
  },
};

describe('escapeCsv', () => {
  it('quotes and doubles embedded quotes', () => {
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
  });

  it('neutralises spreadsheet formula injection', () => {
    // Hostnames are user input and ISP/city strings come from third-party APIs,
    // so a leading =, +, - or @ must not reach Excel as a live formula.
    for (const payload of ['=cmd|\'/c calc\'!A1', '+1+1', '-2+3', '@SUM(A1)']) {
      expect(escapeCsv(payload)).toBe(`"'${payload}"`);
    }
  });

  it('neutralises leading tab and carriage return', () => {
    expect(escapeCsv('\t=1+1')).toBe('"\'\t=1+1"');
    expect(escapeCsv('\r=1+1')).toBe('"\'\r=1+1"');
  });

  it('renders absent values as empty, never zero', () => {
    expect(escapeCsv(null)).toBe('""');
    expect(escapeCsv(undefined)).toBe('""');
    expect(escapeCsv('')).toBe('""');
  });

  it('leaves ordinary values alone', () => {
    expect(escapeCsv(42)).toBe('"42"');
    expect(escapeCsv('cloudflare.com')).toBe('"cloudflare.com"');
  });
});

describe('generateSpeedtestCsv', () => {
  it('emits the measured values rather than empty columns', () => {
    const csv = generateSpeedtestCsv([speedItem]);
    const [, row] = csv.split('\n');

    // The original read downloadMbps / uploadMbps / pingMs / jitterMs.
    expect(row).toContain('"94.5"');
    expect(row).toContain('"12.25"');
    expect(row).toContain('"14"');
    expect(row).toContain('"3"');
    expect(row).toContain('"C"');
    expect(row).toContain('"Cloudflare Global Edge CDN"');
  });

  it('leaves unmeasured values blank instead of writing 0', () => {
    const failed: HistoryItem = {
      ...speedItem,
      data: {
        ...(speedItem.data as object),
        downloadSpeed: null,
        uploadSpeed: null,
        ping: null,
        jitter: null,
        bufferbloatScore: null,
        failures: [
          { metric: 'downloadSpeed', reason: 'api-unreachable', detail: 'No bytes arrived.' },
        ],
      },
    };
    const [, row] = generateSpeedtestCsv([failed]).split('\n');

    expect(row).not.toContain('"0"');
    expect(row).toContain('No bytes arrived.');
  });
});

describe('generatePingCsv', () => {
  it('emits the measured values rather than empty columns', () => {
    const [, row] = generatePingCsv([pingItem]).split('\n');

    // The original read sent / received / lossPercent / minRttMs / maxRttMs /
    // avgRttMs / jitterMs — none of which PingResult has.
    expect(row).toContain('"15"');
    expect(row).toContain('"14"');
    expect(row).toContain('"7"');
    expect(row).toContain('"11"');
    expect(row).toContain('"48"');
    expect(row).toContain('"19"');
  });
});

describe('GeoIP export coverage', () => {
  it('is registered as an exportable type', () => {
    // GeoIP records were saved to history but omitted from TEST_TYPES, so they
    // never reached any CSV, the ZIP, or the manifest.
    expect(TEST_TYPES.map((t) => t.id)).toContain('geoip');
  });

  it('formats a geoip record', () => {
    const item: HistoryItem = {
      id: 'geo_1',
      type: 'geoip',
      timestamp: 1_700_000_000_000,
      title: 'GeoIP',
      summary: 'summary',
      data: { ip: '1.1.1.1', query: '1.1.1.1', city: 'Brisbane', country: 'Australia' },
    };
    const [, row] = generateGeoIpCsv([item]).split('\n');
    expect(row).toContain('"1.1.1.1"');
    expect(row).toContain('"Brisbane"');
  });

  it('routes geoip through the dispatcher', () => {
    const item: HistoryItem = {
      id: 'geo_1',
      type: 'geoip',
      timestamp: 1,
      title: 't',
      summary: 's',
      data: { ip: '8.8.8.8' },
    };
    expect(getCsvForType([item], 'geoip')).toContain('8.8.8.8');
  });
});

describe('answer-layer exports', () => {
  const triageItem: HistoryItem = {
    id: 'triage_1',
    type: 'triage',
    timestamp: 1_700_000_000_000,
    title: 'Triage',
    summary: 'summary',
    data: {
      id: 'triage_1',
      timestamp: 1_700_000_000_000,
      attribution: 'local-network',
      headline: 'It is your local network, not the internet.',
      summary: 's',
      totalTimeMs: 8123,
      findings: [
        {
          ruleId: 'bufferbloat',
          title: 'Latency collapses under load',
          layer: 'local-network',
          confidence: 'confirmed',
          severity: 'degrading',
          verdict: 'Round-trip time rose from 18 ms to 80 ms.',
          remediation: ['Enable SQM', 'Cap upload'],
          evidence: [{ metric: 'speed.loadedPing', observation: '80 ms under load' }],
        },
      ],
      steps: [
        { id: 'browser-online', label: 'l', question: 'q', status: 'pass', note: 'n' },
        { id: 'dns', label: 'l', question: 'q', status: 'skipped', note: 'n' },
      ],
      failures: [{ metric: 'bandwidth', reason: 'not-attempted', detail: 'skipped' }],
      snapshot: {},
    },
  };

  it('writes one row per ranked finding with its evidence', () => {
    const [header, row] = generateTriageCsv([triageItem]).split('\n');
    expect(header).toContain('Rule ID');
    expect(row).toContain('"bufferbloat"');
    expect(row).toContain('"local-network"');
    expect(row).toContain('"confirmed"');
    expect(row).toContain('"Enable SQM | Cap upload"');
    expect(row).toContain('"speed.loadedPing: 80 ms under load"');
    // One of two steps passed.
    expect(row).toContain('"1"');
  });

  it('still exports a run that found nothing, carrying its attribution', () => {
    // "Checked and found nothing" and "never ran" must stay distinguishable in
    // a spreadsheet, not collapse into an identical empty row.
    const clean: HistoryItem = {
      ...triageItem,
      data: { ...triageItem.data, attribution: 'no-fault-found', findings: [], failures: [] },
    };
    const rows = generateTriageCsv([clean]).split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('"no-fault-found"');
  });

  it('writes one dual-stack row per probe and never says false for unchecked', () => {
    const item: HistoryItem = {
      id: 'ds_1',
      type: 'dualstack',
      timestamp: 1_700_000_000_000,
      title: 'Dual stack',
      summary: 's',
      data: {
        verdict: 'ipv4-only',
        ipv4Reachable: true,
        ipv6Reachable: false,
        preferredFamily: null,
        preferredFamilySource: null,
        probes: [
          {
            family: 'ipv4',
            host: 'ipv4.icanhazip.com',
            url: 'https://ipv4.icanhazip.com/',
            outcome: 'answered',
            roundTripMs: 42,
            observedIp: '203.0.113.9',
            error: null,
          },
          {
            family: 'ipv6',
            host: 'ipv6.icanhazip.com',
            url: 'https://ipv6.icanhazip.com/',
            outcome: 'no-response',
            roundTripMs: null,
            observedIp: null,
            error: 'Failed to fetch',
          },
        ],
        failures: [],
      },
    };
    const [, v4Row, v6Row] = generateDualStackCsv([item]).split('\n');
    expect(v4Row).toContain('"203.0.113.9"');
    expect(v4Row).toContain('"42"');
    // An unmeasured round trip is blank, never 0 — a blank means not measured.
    expect(v6Row).toContain('""');
    expect(v6Row).not.toContain('"0"');
    expect(v6Row).toContain('"no response"');
  });

  it('renders an unchecked family as "not checked" rather than as a failure', () => {
    const item: HistoryItem = {
      id: 'ds_2',
      type: 'dualstack',
      timestamp: 1,
      title: 't',
      summary: 's',
      data: { verdict: null, ipv4Reachable: null, ipv6Reachable: null, probes: [], failures: [] },
    };
    const [, row] = generateDualStackCsv([item]).split('\n');
    expect(row).toContain('"not checked"');
    expect(row).not.toContain('"no response"');
  });

  it('writes one interception row per probe alongside the DNS verdict', () => {
    const item: HistoryItem = {
      id: 'cap_1',
      type: 'captive',
      timestamp: 1_700_000_000_000,
      title: 'Captive',
      summary: 's',
      data: {
        portal: {
          pageProtocol: 'https:',
          verdict: 'no-interception-detected',
          probes: [
            {
              label: 'Cloudflare edge metadata',
              url: 'https://speed.cloudflare.com/meta',
              expectation: 'JSON naming the edge',
              outcome: 'verified',
              roundTripMs: 33,
              note: null,
            },
          ],
          failures: [],
        },
        dns: {
          verdict: 'resolver-working',
          hostnameReachable: true,
          literalIpReachable: true,
          failures: [],
        },
      },
    };
    const [header, row] = generateCaptivePortalCsv([item]).split('\n');
    expect(header).toContain('DNS Verdict');
    expect(row).toContain('"no-interception-detected"');
    expect(row).toContain('"resolver-working"');
    expect(row).toContain('"Cloudflare edge metadata"');
    expect(row).toContain('"33"');
  });

  it('routes all three new types through the dispatcher', () => {
    expect(getCsvForType([triageItem], 'triage')).toContain('bufferbloat');
    for (const id of ['triage', 'dualstack', 'captive']) {
      expect(TEST_TYPES.map((t) => t.id)).toContain(id);
    }
  });

  it('escapes a formula-injecting probe note', () => {
    // Probe notes carry third-party error strings straight into the export.
    const item: HistoryItem = {
      id: 'cap_2',
      type: 'captive',
      timestamp: 1,
      title: 't',
      summary: 's',
      data: {
        portal: {
          pageProtocol: 'https:',
          verdict: 'mixed',
          probes: [
            {
              label: 'x',
              url: 'https://x.test/',
              expectation: 'y',
              outcome: 'content-mismatch',
              roundTripMs: 1,
              note: '=cmd|\'/c calc\'!A1',
            },
          ],
          failures: [],
        },
        dns: {},
      },
    };
    expect(generateCaptivePortalCsv([item])).toContain('"\'=cmd');
  });
});

describe('generateDnsBenchmarkCsv', () => {
  const resolver = (over: Record<string, unknown> = {}) => ({
    resolverId: 'cloudflare',
    label: 'Cloudflare',
    operator: 'Cloudflare, Inc.',
    endpoint: 'https://cloudflare-dns.com/dns-query',
    policyNote: '',
    cached: { answered: 5, attempted: 5, medianMs: 18, p95Ms: null, minMs: 15, maxMs: 24, stdDevMs: 3 },
    uncached: { answered: 5, attempted: 5, medianMs: 41, p95Ms: null, minMs: 38, maxMs: 50, stdDevMs: 4 },
    dotcom: { answered: 5, attempted: 5, medianMs: 33, p95Ms: null, minMs: 30, maxMs: 40, stdDevMs: 3 },
    uncachedCostMs: 23,
    nxdomainHonesty: 'honest',
    nxdomainDetail: '',
    dnssec: 'validates',
    dnssecDetail: '',
    outcome: 'measured',
    note: 'Cloudflare answered every kind of query.',
    ...over,
  });

  const item = (resolvers: unknown[], over: Record<string, unknown> = {}): HistoryItem => ({
    id: 'bench_1',
    type: 'dnsbench',
    timestamp: 1,
    title: 't',
    summary: 's',
    data: {
      resolvers,
      samplesPerMetric: 5,
      dnssecRequested: true,
      fastestCachedResolverId: 'cloudflare',
      fastestIsWithinNoise: false,
      failures: [],
      ...over,
    },
  });

  it('writes every field under the name the interface actually uses', () => {
    // The direct guard against the six-column-silently-blank class of bug: if a
    // field is renamed in types.ts, the cast in the generator fails to compile
    // and this assertion fails if it does not.
    const [, row] = generateDnsBenchmarkCsv([item([resolver()])]).split('\n');
    expect(row).toContain('"Cloudflare"');
    expect(row).toContain('"Cloudflare, Inc."');
    expect(row).toContain('"18"');
    expect(row).toContain('"41"');
    expect(row).toContain('"33"');
    expect(row).toContain('"23"');
    expect(row).toContain('"honest"');
    expect(row).toContain('"validates"');
  });

  it('leaves unmeasured values blank instead of writing 0', () => {
    // A resolver the browser could not reach would otherwise export as the
    // fastest one in the file.
    const empty = { answered: 0, attempted: 5, medianMs: null, p95Ms: null, minMs: null, maxMs: null, stdDevMs: null };
    const [, row] = generateDnsBenchmarkCsv([
      item([
        resolver({
          cached: empty,
          uncached: empty,
          dotcom: empty,
          uncachedCostMs: null,
          dnssec: null,
          outcome: 'no-readable-answer',
          note: 'No readable answer came back.',
        }),
      ]),
    ]).split('\n');
    expect(row).toContain('""');
    expect(row).toContain('"no-readable-answer"');
    expect(row).toContain('"not checked"');
    // The answered/attempted counters are genuine zeroes and must survive.
    expect(row).toContain('"0"');
    expect(row).not.toContain('"0","0","0","0","0"');
  });

  it('exports a genuine zero rather than dropping it', () => {
    // The pair to the test above: this is what proves the generator uses `??`
    // and not `||`.
    const [, row] = generateDnsBenchmarkCsv([
      item([resolver({ uncachedCostMs: 0 })]),
    ]).split('\n');
    expect(row).toContain('"0"');
  });

  it('preserves a negative cost, escaped against formula injection', () => {
    // A negative is a real observation about TTLs and anycast, and escapeCsv's
    // leading-minus guard must not swallow it.
    const [, row] = generateDnsBenchmarkCsv([
      item([resolver({ uncachedCostMs: -4 })]),
    ]).split('\n');
    expect(row).toContain('"\'-4"');
  });

  it('escapes a formula-injecting resolver note', () => {
    // Notes embed fetch error messages, i.e. third-party-influenced text.
    const csv = generateDnsBenchmarkCsv([
      item([resolver({ note: '=cmd|\'/c calc\'!A1' })]),
    ]);
    expect(csv).toContain('"\'=cmd');
  });

  it('still exports a row for a run that measured nothing', () => {
    // An offline run has to stay distinguishable from a run that never happened.
    const csv = generateDnsBenchmarkCsv([
      item([], {
        fastestCachedResolverId: null,
        fastestIsWithinNoise: null,
        failures: [{ metric: 'all', reason: 'network-offline', detail: 'No network connection.' }],
      }),
    ]);
    const [, row] = csv.split('\n');
    expect(row).toContain('all: No network connection.');
    expect(row).toContain('"not determined"');
  });

  it('routes through the dispatcher and is a declared export type', () => {
    expect(getCsvForType([item([resolver()])], 'dnsbench')).toContain('Cloudflare');
    expect(TEST_TYPES.map((t) => t.id)).toContain('dnsbench');
  });
});

describe('generateWalkTestCsv', () => {
  const summary = (over: Record<string, unknown> = {}) => ({
    answered: 6,
    attempted: 6,
    medianMs: 42,
    p95Ms: null,
    minMs: 38,
    maxMs: 51,
    stdDevMs: 4,
    ...over,
  });

  const cell = (targetId: string, over: Record<string, unknown> = {}) => ({
    targetId,
    label: targetId === 'google' ? 'Google' : 'Microsoft 365',
    category: targetId === 'google' ? 'consumer' : 'business',
    summary: summary(),
    jitterMs: 5,
    lastRoundTripMs: 44,
    lastOutcome: 'answered',
    ...over,
  });

  const item = (over: Record<string, unknown> = {}): HistoryItem => ({
    id: 'walk_1',
    type: 'walktest',
    timestamp: 1,
    title: 't',
    summary: 's',
    data: {
      targets: [
        {
          id: 'google',
          label: 'Google',
          category: 'consumer',
          host: 'www.google.com',
          url: 'https://www.google.com/generate_204',
          note: '',
        },
        {
          id: 'm365',
          label: 'Microsoft 365',
          category: 'business',
          host: 'outlook.office365.com',
          url: 'https://outlook.office365.com/robots.txt',
          note: '',
        },
      ],
      waypoints: [
        {
          id: 'w1',
          label: 'Desk',
          startedAt: 1,
          endedAt: 2,
          reportedConnectionType: 'wifi',
          reportedEffectiveType: '4g',
        },
      ],
      samples: [],
      samplesDropped: 0,
      rounds: 7,
      intervalMs: 3000,
      durationMs: 21_000,
      perTarget: [cell('google'), cell('m365')],
      perWaypoint: [
        {
          waypointId: 'w1',
          label: 'Desk',
          attempted: 14,
          answered: 13,
          rounds: 7,
          perTarget: [cell('google'), cell('m365')],
          medianOfTargetMediansMs: 42,
          pooledTargetIds: ['google', 'm365'],
        },
      ],
      conclusions: ['Everything answered at the desk.'],
      failures: [],
      ...over,
    },
  });

  it('writes every field under the name the interface actually uses', () => {
    // The guard against the six-columns-silently-blank class of bug: rename a
    // field in types.ts and either the cast stops compiling or this fails.
    const rows = generateWalkTestCsv([item()]).split('\n');
    expect(rows).toHaveLength(3); // header + one row per destination per spot
    expect(rows[1]).toContain('"Desk"');
    expect(rows[1]).toContain('"Google"');
    expect(rows[1]).toContain('"www.google.com"');
    expect(rows[1]).toContain('"42"');
    expect(rows[2]).toContain('"Microsoft 365"');
    expect(rows[2]).toContain('"outlook.office365.com"');
  });

  it('leaves an unmeasured destination blank rather than exporting it as zero', () => {
    // A dead spot would otherwise become the fastest cell in the spreadsheet.
    const dead = {
      ...cell('m365'),
      summary: summary({
        answered: 0,
        attempted: 6,
        medianMs: null,
        minMs: null,
        maxMs: null,
        stdDevMs: null,
      }),
      jitterMs: null,
      lastRoundTripMs: null,
      lastOutcome: 'no-response',
    };
    const csv = generateWalkTestCsv([
      item({
        perTarget: [cell('google'), dead],
        perWaypoint: [
          {
            waypointId: 'w1',
            label: 'Desk',
            attempted: 12,
            answered: 6,
            rounds: 6,
            perTarget: [cell('google'), dead],
            medianOfTargetMediansMs: 42,
            pooledTargetIds: ['google'],
          },
        ],
      }),
    ]);
    const row = csv.split('\n')[2];

    expect(row).toContain('"Microsoft 365"');
    expect(row).toContain('"0","6"'); // answered / attempted survive
    expect(row).not.toContain('"0","0"'); // but no timing became a zero
    // Median, min, max, p95, std dev and jitter are all empty cells.
    expect(row.split(',').filter((c) => c === '""').length).toBeGreaterThanOrEqual(6);
  });

  it('still exports a row for a walk that measured nothing', () => {
    const csv = generateWalkTestCsv([
      item({
        rounds: 0,
        perTarget: [],
        perWaypoint: [],
        conclusions: [],
        failures: [
          { metric: 'google', reason: 'not-attempted', detail: 'Google was not probed.' },
        ],
      }),
    ]);
    const row = csv.split('\n')[1];
    expect(row).toContain('google: Google was not probed.');
  });

  it('routes through the dispatcher and is a declared export type', () => {
    expect(getCsvForType([item()], 'walktest')).toContain('Desk');
    expect(TEST_TYPES.map((t) => t.id)).toContain('walktest');
  });
});

describe('every declared export type produces a CSV with a header row', () => {
  it.each(TEST_TYPES.map((t) => t.id))('%s', (type) => {
    const csv = getCsvForType([], type);
    expect(csv.split('\n')[0].length).toBeGreaterThan(0);
  });
});
