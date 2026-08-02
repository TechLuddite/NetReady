import { describe, it, expect } from 'vitest';
import { meanConsecutiveDelta, createId, calculateNetReadyScore, parseTargetHosts } from './network';
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
