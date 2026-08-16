import { describe, it, expect } from 'vitest';
import {
  meanConsecutiveDelta,
  createId,
  calculateNetReadyScore,
  parseTargetHosts,
  percentile,
  median,
  sampleStdDev,
  summariseSamples,
} from './network';
import { isPrivateOrLoopback } from './tracert';
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
