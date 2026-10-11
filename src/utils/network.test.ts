import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  meanConsecutiveDelta,
  createId,
  calculateNetReadyScore,
  parseTargetHosts,
  percentile,
  median,
  sampleStdDev,
  summariseSamples,
  timeoutSignal,
  runSpeedTest,
  testWebSocket,
  scanSinglePort,
  scanPortList,
} from './network';
import { isPrivateOrLoopback } from './geo';
import type { SpeedTestResult, PingResult } from '../types';

const speed = (over: Partial<SpeedTestResult> = {}): SpeedTestResult => ({
  id: 's',
  timestamp: 0,
  downloadSpeed: 100,
  uploadSpeed: 20,
  ping: 15,
  jitter: 2,
  ...over,
});

const ping = (over: Partial<PingResult> = {}): PingResult => ({
  id: 'p',
  timestamp: 0,
  target: 't',
  label: 'l',
  packetsSent: 10,
  packetsReceived: 10,
  packetLoss: 0,
  minPing: 10,
  maxPing: 20,
  avgPing: 15,
  jitter: 2,
  points: [],
  ...over,
});

describe('meanConsecutiveDelta', () => {
  it('is undefined below two samples', () => {
    // Jitter from a single sample is not a small number, it is no number. The
    // three inlined copies of this calculation returned 0, 2 and 3 instead.
    expect(meanConsecutiveDelta([])).toBeNull();
    expect(meanConsecutiveDelta([42])).toBeNull();
  });

  it('averages the absolute differences', () => {
    expect(meanConsecutiveDelta([10, 20])).toBe(10);
    expect(meanConsecutiveDelta([10, 20, 10])).toBe(10);
    expect(meanConsecutiveDelta([5, 5, 5, 5])).toBe(0);
  });
});

describe('createId', () => {
  it('does not collide within a millisecond', () => {
    // `'<type>_' + Date.now()` produced duplicate React keys and made
    // deleteHistoryItem remove two records at once.
    const ids = new Set(Array.from({ length: 2000 }, () => createId('ping')));
    expect(ids.size).toBe(2000);
  });

  it('keeps the prefix', () => {
    expect(createId('speed').startsWith('speed_')).toBe(true);
  });
});

describe('calculateNetReadyScore', () => {
  it('returns null when nothing has been measured', () => {
    // Previously defaulted to dl=30, ul=10, lat=35, jit=5 and handed back a
    // confident letter grade to a user who had never run a test.
    expect(calculateNetReadyScore(null, null)).toBeNull();
    expect(calculateNetReadyScore(undefined, undefined)).toBeNull();
  });

  it('returns null when every measurement failed', () => {
    const failed = speed({ downloadSpeed: null, uploadSpeed: null, ping: null, jitter: null });
    expect(calculateNetReadyScore(failed, null)).toBeNull();
  });

  it('does not rewrite a genuine zero as a typical value', () => {
    // The old code used `||`, so a measured 0 Mbps silently became 30 Mbps.
    const zero = calculateNetReadyScore(speed({ downloadSpeed: 0 }), null);
    expect(zero).not.toBeNull();
    expect(zero!.downloadScore).toBeLessThan(20);
    expect(zero!.missingInputs).not.toContain('download speed');
  });

  it('scores only the categories whose inputs exist', () => {
    // Latency and jitter only: bandwidth categories must stay unscored.
    const latencyOnly = calculateNetReadyScore(null, ping());
    expect(latencyOnly).not.toBeNull();
    expect(latencyOnly!.gamingScore).not.toBeNull();
    expect(latencyOnly!.voipScore).not.toBeNull();
    expect(latencyOnly!.streamingScore).toBeNull();
    expect(latencyOnly!.downloadScore).toBeNull();
    expect(latencyOnly!.missingInputs).toContain('download speed');
  });

  it('names the missing inputs in its findings', () => {
    const partial = calculateNetReadyScore(speed({ uploadSpeed: null }), null);
    expect(partial!.missingInputs).toEqual(['upload speed']);
    expect(partial!.details.join(' ')).toContain('upload speed');
  });

  it('describes only what was measured', () => {
    const noJitter = calculateNetReadyScore(speed({ jitter: null }), null);
    expect(noJitter!.details.join(' ')).not.toMatch(/Jitter is \d/);
  });

  it('grades a good connection well and a poor one badly', () => {
    const good = calculateNetReadyScore(speed({ downloadSpeed: 500 }), ping({ avgPing: 8, jitter: 1 }));
    const bad = calculateNetReadyScore(
      speed({ downloadSpeed: 1.5, uploadSpeed: 0.4 }),
      ping({ avgPing: 320, jitter: 90 }),
    );
    expect(good!.overallScore).toBeGreaterThan(bad!.overallScore);
    expect(['A+', 'A']).toContain(good!.grade);
    expect(['D', 'F']).toContain(bad!.grade);
  });

  it('surfaces bufferbloat as a finding when it is the binding constraint', () => {
    const bloated = calculateNetReadyScore(speed({ bufferbloatScore: 'F', loadedPing: 400 }), null);
    expect(bloated!.details.join(' ')).toContain('bufferbloat');
  });
});

describe('parseTargetHosts', () => {
  it('expands a small CIDR block', () => {
    expect(parseTargetHosts('192.168.1.0/30')).toEqual(['192.168.1.1', '192.168.1.2']);
  });

  it('expands a dashed range', () => {
    expect(parseTargetHosts('10.0.0.1-3')).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  });

  it('splits comma-separated targets', () => {
    expect(parseTargetHosts('a.example, b.example')).toEqual(['a.example', 'b.example']);
  });

  it('strips scheme and path from a hostname', () => {
    expect(parseTargetHosts('https://example.com/some/path')).toEqual(['example.com']);
  });

  it('caps expansion rather than enumerating a whole /16', () => {
    // The cap itself is fine; the UI must warn about it, which is why this is
    // pinned to an exact number rather than "something reasonable".
    expect(parseTargetHosts('10.0.0.0/16')).toHaveLength(256);
  });

  it('rejects malformed octets rather than wrapping them into another network', () => {
    for (const input of ['999.0.0.1/30', '192.168.1.256', '192.168.1.1-300']) {
      expect(() => parseTargetHosts(input)).toThrow('Invalid IPv4 address');
    }
  });

  it('rejects unsupported or fractional CIDR prefixes', () => {
    for (const input of ['10.0.0.1/8', '10.0.0.1/30.5', '10.0.0.1/30junk']) {
      expect(() => parseTargetHosts(input)).toThrow('CIDR prefixes');
    }
  });

  it('preserves hostnames containing hyphens', () => {
    expect(parseTargetHosts('my-dev-server.example')).toEqual(['my-dev-server.example']);
  });
});

describe('timeoutSignal', () => {
  it('propagates cancellation that occurred before the helper was called', () => {
    const gate = timeoutSignal(10000, AbortSignal.abort());
    expect(gate.signal.aborted).toBe(true);
    gate.done();
  });
});

describe('unmeasured scanner ports', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports browser-restricted ports as not tested without a latency', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await scanSinglePort('192.168.1.1', 22);
    expect(result.status).toBe('not-tested');
    expect(result.latencyMs).toBeNull();
    expect(result.description).toContain('browser security policy');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not classify requested ports that were skipped after discovery failed', async () => {
    const fetch = vi.fn(async (_url: string) => {
      const error = new Error('Probe timed out');
      error.name = 'AbortError';
      throw error;
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('Image', class {
      src = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
    });
    const pending = scanPortList('192.168.1.1-2', [3306, 22]);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(result.ports).toHaveLength(4);
    expect(result.ports.every((port) => port.status === 'not-tested' && port.latencyMs === null)).toBe(true);
    expect(result.openPortsCount).toBe(0);
    expect(result.closedPortsCount).toBe(0);
    expect(result.filteredPortsCount).toBe(0);
    expect(fetch.mock.calls).toHaveLength(6);
    expect(fetch.mock.calls.every(([url]) => !String(url).includes(':3306/') && !String(url).includes(':22/'))).toBe(true);
  });

  it('keeps measured zero latency and excludes restricted ports from filtered totals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null)));
    const result = await scanPortList('192.168.1.1', [80, 22]);
    expect(result.ports.find((port) => port.port === 80)).toMatchObject({ status: 'open', latencyMs: 0 });
    expect(result.ports.find((port) => port.port === 22)).toMatchObject({ status: 'not-tested', latencyMs: null });
    expect(result.openPortsCount).toBe(1);
    expect(result.filteredPortsCount).toBe(0);
  });
});

describe('bufferbloat load evidence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('withholds the grade when latency works but every transfer is blocked', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('bytes=0')) return new Response(null);
      throw new TypeError('Transfer blocked');
    }));
    const pending = runSpeedTest();
    await vi.advanceTimersByTimeAsync(11000);
    const result = await pending;
    expect(result.ping).not.toBeNull();
    expect(result.totalBytesDownloaded).toBe(0);
    expect(result.downloadSpeed).toBeNull();
    expect(result.loadedPing).toBeNull();
    expect(result.bufferbloatScore).toBeNull();
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'bufferbloatScore', reason: 'insufficient-samples' }),
    ]));
  });

  it('grades only when actual download bytes overlap the latency sample', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('bytes=0')) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return new Response(null);
      }
      if (url.includes('__up')) throw new TypeError('Upload blocked');
      return { body: { getReader: () => ({
        read: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { done: false, value: new Uint8Array(1000) };
        },
        cancel: async () => {},
      }) } };
    }));
    const pending = runSpeedTest();
    await vi.advanceTimersByTimeAsync(11000);
    const result = await pending;
    expect(result.downloadSpeed).not.toBeNull();
    expect(result.loadedPing).not.toBeNull();
    expect(result.bufferbloatScore).not.toBeNull();
  });

  it('does not mistake an earlier completed transfer for concurrent load', async () => {
    let downloads = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('bytes=0')) return new Response(null);
      if (url.includes('__down') && downloads++ === 0) {
        return new Response(new Uint8Array(1000000));
      }
      throw new TypeError('Subsequent transfers blocked');
    }));
    const pending = runSpeedTest();
    await vi.advanceTimersByTimeAsync(11000);
    const result = await pending;
    expect(result.totalBytesDownloaded).toBeGreaterThan(0);
    expect(result.loadedPing).toBeNull();
    expect(result.bufferbloatScore).toBeNull();
  });
});

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instance: MockWebSocket;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor() { MockWebSocket.instance = this; }
  send(payload: string) { this.sent.push(payload); }
  close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.(); }
  open() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  message(data: string) { this.onmessage?.({ data }); }
}

describe('WebSocket measurements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports missing timings and reasons on handshake failure', async () => {
    const pending = testWebSocket('wss://test.example');
    MockWebSocket.instance.onerror?.();
    const result = await pending;
    expect(result.status).toBe('error');
    expect(result.handshakeTimeMs).toBeNull();
    expect(result.avgPingMs).toBeNull();
    expect(result.failures?.map((failure) => failure.metric)).toEqual(['handshakeTimeMs', 'avgPingMs']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles constructor failures and cancels the timeout', async () => {
    vi.stubGlobal('WebSocket', class {
      constructor() { throw new Error('Invalid WebSocket URL'); }
    });
    const result = await testWebSocket('invalid');
    expect(result.status).toBe('error');
    expect(result.handshakeTimeMs).toBeNull();
    expect(result.avgPingMs).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles when the server closes without an echo', async () => {
    const pending = testWebSocket('wss://test.example');
    MockWebSocket.instance.open();
    MockWebSocket.instance.close();
    const result = await pending;
    expect(result.status).toBe('closed');
    expect(result.handshakeTimeMs).not.toBeNull();
    expect(result.avgPingMs).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores unsolicited messages and times out without inventing RTT', async () => {
    const pending = testWebSocket('wss://test.example');
    const socket = MockWebSocket.instance;
    socket.open();
    socket.message('Welcome, this is not an echo');
    await vi.advanceTimersByTimeAsync(4000);
    const result = await pending;
    expect(result.status).toBe('error');
    expect(result.messagesReceived).toBe(0);
    expect(result.avgPingMs).toBeNull();
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'avgPingMs', reason: 'timeout' }),
    ]));
  });

  it('accepts exact echoes once and rejects duplicates and stale replies', async () => {
    const pending = testWebSocket('wss://test.example');
    const socket = MockWebSocket.instance;
    socket.open();
    for (let index = 0; index < 3; index++) {
      const payload = socket.sent[index];
      if (index > 0) socket.message(socket.sent[index - 1]);
      await vi.advanceTimersByTimeAsync(10);
      socket.message(payload);
      socket.message(payload);
      await vi.advanceTimersByTimeAsync(150);
    }
    const result = await pending;
    expect(result.status).toBe('connected');
    expect(result.messagesSent).toBe(3);
    expect(result.messagesReceived).toBe(3);
    expect(result.pings).toEqual([10, 10, 10]);
    expect(result.avgPingMs).toBe(10);
    expect(result.failures).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a measured partial RTT while reporting an incomplete timeout', async () => {
    const pending = testWebSocket('wss://test.example');
    const socket = MockWebSocket.instance;
    socket.open();
    await vi.advanceTimersByTimeAsync(10);
    socket.message(socket.sent[0]);
    await vi.advanceTimersByTimeAsync(4000);
    const result = await pending;
    expect(result.status).toBe('error');
    expect(result.pings).toEqual([10]);
    expect(result.avgPingMs).toBe(10);
    expect(result.messagesReceived).toBe(1);
    expect(result.failures).toEqual([
      expect.objectContaining({ metric: 'echoReplies', reason: 'timeout' }),
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('isPrivateOrLoopback', () => {
  it('recognises RFC 1918, loopback and link-local space', () => {
    for (const ip of [
      '10.0.0.1',
      '127.0.0.1',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.254', // the /12 extends past 172.16, which the old check missed
      '169.254.1.1',
      'localhost',
    ]) {
      expect(isPrivateOrLoopback(ip)).toBe(true);
    }
  });

  it('treats globally routable addresses as public', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1', '11.0.0.1']) {
      expect(isPrivateOrLoopback(ip)).toBe(false);
    }
  });
});

describe('percentile', () => {
  it('returns null rather than a number when there is nothing to summarise', () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it('returns the only sample when there is one', () => {
    expect(percentile([5], 0.5)).toBe(5);
    expect(percentile([5], 0.95)).toBe(5);
  });

  it('interpolates the way R-7 does', () => {
    // Pinned to exact values so a future switch to nearest-rank fails loudly
    // instead of quietly shifting every reported percentile in the app.
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBeCloseTo(4.8, 10);
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5);
  });

  it('does not depend on the caller having sorted the input', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
  });

  it('leaves the caller’s array alone', () => {
    const samples = [3, 1, 2];
    percentile(samples, 0.5);
    expect(samples).toEqual([3, 1, 2]);
  });
});

describe('median', () => {
  it('is null on an empty array and correct on an odd and even count', () => {
    expect(median([])).toBeNull();
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('sampleStdDev', () => {
  it('returns null below two samples', () => {
    // The spread of one point is not zero spread, it is no spread. Reporting 0
    // would claim a consistency that was never observed.
    expect(sampleStdDev([])).toBeNull();
    expect(sampleStdDev([7])).toBeNull();
  });

  it('uses the n-1 divisor', () => {
    expect(sampleStdDev([2, 4, 4, 4, 5, 5, 7, 9])!).toBeCloseTo(2.13809, 4);
  });

  it('reports genuinely identical samples as zero spread', () => {
    expect(sampleStdDev([4, 4, 4])).toBe(0);
  });
});

describe('summariseSamples', () => {
  const many = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

  it('reports the sample count but no statistics below the minimum', () => {
    // n stays readable so a caller can tell "measured twice" from "never
    // measured", but nothing is derived from two points.
    const s = summariseSamples([10, 20], 3);
    expect(s.n).toBe(2);
    expect(s.medianMs).toBeNull();
    expect(s.p95Ms).toBeNull();
    expect(s.minMs).toBeNull();
    expect(s.maxMs).toBeNull();
    expect(s.stdDevMs).toBeNull();
  });

  it('reports nothing at all for zero samples', () => {
    const s = summariseSamples([]);
    expect(s.n).toBe(0);
    expect(s.medianMs).toBeNull();
  });

  it('withholds p95 until there are enough samples for it to mean anything', () => {
    // At n=5 the R-7 p95 sits within one interpolation step of the maximum, so
    // publishing it would relabel "the slowest sample" as a percentile.
    const five = summariseSamples(many(5));
    expect(five.medianMs).toBe(3);
    expect(five.maxMs).toBe(5);
    expect(five.p95Ms).toBeNull();

    const ten = summariseSamples(many(10));
    expect(ten.medianMs).toBe(6); // R-7 median of 1..10 is 5.5, rounded
    expect(ten.p95Ms).toBe(10);
  });

  it('preserves a genuine zero instead of treating it as missing', () => {
    // The `||` trap, in the newest helper: a resolver answering from memory in
    // under half a millisecond must not read as "not measured".
    const s = summariseSamples([0, 0, 0]);
    expect(s.medianMs).toBe(0);
    expect(s.minMs).toBe(0);
    expect(s.stdDevMs).toBe(0);
  });

  it('rounds to whole milliseconds, matching the clock’s actual resolution', () => {
    const s = summariseSamples([10.4, 10.6, 11.2]);
    expect(s.medianMs).toBe(11);
    expect(Number.isInteger(s.minMs)).toBe(true);
  });
});
