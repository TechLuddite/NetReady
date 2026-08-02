import { describe, it, expect } from 'vitest';
import { attributeBottleneck, constraintLabel } from './bottleneck';
import { calculateNetReadyScore } from '../utils/network';
import type { PingResult, SpeedTestResult } from '../types';

const speed = (over: Partial<SpeedTestResult> = {}): SpeedTestResult => ({
  id: 's',
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
  id: 'p',
  timestamp: 0,
  target: 't',
  label: 'l',
  packetsSent: 10,
  packetsReceived: 10,
  packetLoss: 0,
  minPing: null,
  maxPing: null,
  avgPing: null,
  jitter: null,
  points: [],
  ...over,
});

const attribute = (s: SpeedTestResult | null, p: PingResult | null) =>
  attributeBottleneck(s, p, calculateNetReadyScore(s, p));

describe('attributeBottleneck', () => {
  it('says nothing when nothing has been measured', () => {
    const r = attribute(null, null);
    expect(r.constraint).toBeNull();
    expect(r.unavailableReason).toMatch(/Nothing has been measured/);
    expect(r.sensitivities).toEqual([]);
  });

  it('names bandwidth when bandwidth is what is holding the score down', () => {
    const r = attribute(
      speed({ downloadSpeed: 3, uploadSpeed: 30, ping: 12, jitter: 1 }),
      ping({ avgPing: 12, jitter: 1 }),
    );
    expect(r.constraint).toBe('download');
    expect(r.headline).toContain('download bandwidth');
    expect(r.evidence[0].observation).toContain('3 Mbps');
  });

  it('names latency when the link is fast but far', () => {
    const r = attribute(
      speed({ downloadSpeed: 500, uploadSpeed: 100, ping: 320, jitter: 2 }),
      ping({ avgPing: 320, jitter: 2 }),
    );
    expect(r.constraint).toBe('latency');
  });

  it('names jitter when only jitter is bad', () => {
    const r = attribute(
      speed({ downloadSpeed: 500, uploadSpeed: 100, ping: 12, jitter: 60 }),
      ping({ avgPing: 12, jitter: 60 }),
    );
    expect(r.constraint).toBe('jitter');
  });

  it('promotes bufferbloat over bandwidth, and says why', () => {
    // The headline case from the brief: a decent-looking link whose real
    // problem is queuing, which the numeric score does not model at all.
    const r = attribute(
      speed({ downloadSpeed: 45, uploadSpeed: 12, ping: 18, jitter: 3, loadedPing: 80 }),
      ping({ avgPing: 18, jitter: 3 }),
    );
    expect(r.constraint).toBe('bufferbloat');
    expect(r.headline).toMatch(/binding constraint is bufferbloat, not bandwidth/);
    // The grade and the experience diverge here — the headline has to say so,
    // or "Grade A+" and "something is constraining you" read as a contradiction.
    expect(r.headline).toMatch(/on the numbers/);
    expect(r.detail).toContain('62 ms');
    expect(r.evidence.map((e) => e.metric)).toEqual(['speed.ping', 'speed.loadedPing']);
  });

  it('leaves bufferbloat out of it when the increase is small', () => {
    const r = attribute(
      speed({ downloadSpeed: 4, uploadSpeed: 12, ping: 18, jitter: 3, loadedPing: 30 }),
      ping({ avgPing: 18, jitter: 3 }),
    );
    expect(r.constraint).toBe('download');
  });

  it('will not invent a bufferbloat verdict from a single sample', () => {
    const r = attribute(
      speed({ downloadSpeed: 4, uploadSpeed: 12, ping: 18, jitter: 3, loadedPing: null }),
      ping({ avgPing: 18, jitter: 3 }),
    );
    expect(r.constraint).toBe('download');
  });

  it('names no constraint when everything measured is already good', () => {
    const r = attribute(
      speed({ downloadSpeed: 900, uploadSpeed: 900, ping: 5, jitter: 1, loadedPing: 6 }),
      ping({ avgPing: 5, jitter: 1 }),
    );
    expect(r.constraint).toBeNull();
    expect(r.headline).toMatch(/nothing measured is holding this back/);
    expect(r.unavailableReason).toBeTruthy();
  });

  it('ranks only the inputs that were actually measured', () => {
    // Download alone. Upload, latency and jitter must not appear as though
    // they had been weighed.
    const r = attribute(speed({ downloadSpeed: 5, ping: 20, jitter: 2 }), null);
    const inputs = r.sensitivities.map((s) => s.input);
    expect(inputs).toContain('download');
    expect(inputs).not.toContain('upload');
  });

  it('treats a measured zero as measured', () => {
    // `??` rather than `||`: a genuine 0 Mbps must be ranked, not discarded.
    const r = attribute(
      speed({ downloadSpeed: 0, uploadSpeed: 20, ping: 20, jitter: 2 }),
      ping({ avgPing: 20, jitter: 2 }),
    );
    expect(r.constraint).toBe('download');
    expect(r.evidence[0].observation).toContain('0 Mbps');
  });

  it('produces sensitivities sorted strongest first', () => {
    const r = attribute(
      speed({ downloadSpeed: 2, uploadSpeed: 30, ping: 200, jitter: 40 }),
      ping({ avgPing: 200, jitter: 40 }),
    );
    const gains = r.sensitivities.map((s) => s.gain);
    expect([...gains].sort((a, b) => b - a)).toEqual(gains);
  });

  it('is deterministic', () => {
    const s = speed({ downloadSpeed: 20, uploadSpeed: 5, ping: 40, jitter: 8, loadedPing: 55 });
    const p = ping({ avgPing: 40, jitter: 8 });
    expect(JSON.stringify(attribute(s, p))).toBe(JSON.stringify(attribute(s, p)));
  });

  it('never leaks a reference value into the output', () => {
    // The "what if" values used inside the sensitivity calculation must not
    // escape as though they had been measured.
    const r = attribute(
      speed({ downloadSpeed: 7, uploadSpeed: 3, ping: 90, jitter: 12 }),
      ping({ avgPing: 90, jitter: 12 }),
    );
    const text = `${r.headline} ${r.detail} ${r.evidence.map((e) => e.observation).join(' ')}`;
    expect(text).not.toContain('200 Mbps');
    expect(text).not.toContain('40 Mbps');
    expect(text).not.toContain('15 ms');
    expect(text).toContain('7 Mbps');
  });
});

describe('constraintLabel', () => {
  it('names every constraint in plain language', () => {
    expect(constraintLabel('bufferbloat')).toBe('bufferbloat');
    expect(constraintLabel('download')).toBe('download bandwidth');
    expect(constraintLabel('latency')).toBe('latency');
  });
});
