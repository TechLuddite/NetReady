import { describe, it, expect } from 'vitest';
import {
  escapeCsv,
  getCsvForType,
  generateSpeedtestCsv,
  generatePingCsv,
  generateGeoIpCsv,
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

describe('every declared export type produces a CSV with a header row', () => {
  it.each(TEST_TYPES.map((t) => t.id))('%s', (type) => {
    const csv = getCsvForType([], type);
    expect(csv.split('\n')[0].length).toBeGreaterThan(0);
  });
});
