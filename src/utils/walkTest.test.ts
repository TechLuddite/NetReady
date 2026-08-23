import { describe, expect, it } from 'vitest';
import type { WalkSample, WalkTarget, WalkWaypoint } from '../types';
import {
  MAX_STORED_SAMPLES,
  WALK_TARGETS,
  buildWalkConclusions,
  buildWalkResult,
  createWaypoint,
  medianOfTargetMedians,
  summariseTarget,
  summariseWaypoint,
} from './walkTest';

const target = (id: string, category: WalkTarget['category'] = 'consumer'): WalkTarget => ({
  id,
  label: id.toUpperCase(),
  category,
  host: `${id}.example`,
  url: `https://${id}.example/robots.txt`,
  note: 'test target',
});

const waypoint = (id: string, label = id): WalkWaypoint => ({
  id,
  label,
  startedAt: 1_700_000_000_000,
  endedAt: null,
  reportedConnectionType: null,
  reportedEffectiveType: null,
});

/** Builds samples for one target: `times` of null means no response. */
const samplesFor = (
  targetId: string,
  waypointId: string,
  times: (number | null)[],
  startRound = 1,
): WalkSample[] =>
  times.map((ms, i) => ({
    targetId,
    waypointId,
    round: startRound + i,
    timestamp: 1_700_000_000_000 + i * 1000,
    roundTripMs: ms,
    outcome: ms === null ? ('no-response' as const) : ('answered' as const),
    connectionSetup: i === 0 && startRound === 1,
  }));

describe('summariseTarget', () => {
  it('reports no statistics at all below the minimum sample count', () => {
    const stats = summariseTarget(target('a'), samplesFor('a', 'w1', [50, 60]));

    expect(stats.summary.attempted).toBe(2);
    expect(stats.summary.answered).toBe(2);
    // Two samples, one of which is the connection-setup probe, leaves one
    // usable timing. Everything derived is absent, not small.
    expect(stats.summary.medianMs).toBeNull();
    expect(stats.summary.minMs).toBeNull();
    expect(stats.summary.maxMs).toBeNull();
    expect(stats.summary.stdDevMs).toBeNull();
  });

  it('excludes the connection-setup probe from the timings but not the counts', () => {
    // The first sample carries DNS, TCP and TLS. If it leaked into the median
    // the answer would be 60, not 40.
    const stats = summariseTarget(target('a'), samplesFor('a', 'w1', [900, 30, 40, 50]));

    expect(stats.summary.attempted).toBe(4);
    expect(stats.summary.answered).toBe(4);
    expect(stats.summary.medianMs).toBe(40);
    expect(stats.summary.maxMs).toBe(50);
  });

  it('counts unanswered probes without inventing a time for them', () => {
    const stats = summariseTarget(target('a'), samplesFor('a', 'w1', [20, 30, null, 40, 50]));

    expect(stats.summary.attempted).toBe(5);
    expect(stats.summary.answered).toBe(4);
    expect(stats.summary.medianMs).toBe(40);
    expect(stats.lastRoundTripMs).toBe(50);
  });

  it('keeps the last outcome even when the last probe failed', () => {
    const stats = summariseTarget(target('a'), samplesFor('a', 'w1', [20, 30, 40, null]));

    expect(stats.lastOutcome).toBe('no-response');
    expect(stats.lastRoundTripMs).toBeNull();
  });

  it('returns an empty summary rather than zeros for a target with no samples', () => {
    const stats = summariseTarget(target('a'), []);

    expect(stats.summary).toEqual({
      answered: 0,
      attempted: 0,
      medianMs: null,
      p95Ms: null,
      minMs: null,
      maxMs: null,
      stdDevMs: null,
    });
    expect(stats.jitterMs).toBeNull();
    expect(stats.lastRoundTripMs).toBeNull();
    expect(stats.lastOutcome).toBeNull();
  });

  it('gives no jitter from a single usable timing', () => {
    expect(summariseTarget(target('a'), samplesFor('a', 'w1', [100, 50])).jitterMs).toBeNull();
  });
});

describe('medianOfTargetMedians', () => {
  it('is null when no destination produced a median', () => {
    const stats = [
      summariseTarget(target('a'), samplesFor('a', 'w1', [10])),
      summariseTarget(target('b'), samplesFor('b', 'w1', [10])),
    ];
    expect(medianOfTargetMedians(stats)).toBeNull();
  });

  it('weights each destination equally rather than pooling raw samples', () => {
    // 'a' answered far more often than 'b'. Pooling every sample would let 'a'
    // dominate; the median of the two medians must sit between them.
    const stats = [
      summariseTarget(target('a'), samplesFor('a', 'w1', [0, 10, 10, 10, 10, 10, 10, 10, 10])),
      summariseTarget(target('b'), samplesFor('b', 'w1', [0, 100, 100, 100])),
    ];
    expect(medianOfTargetMedians(stats)).toBe(55);
  });

  it('restricts the calculation to the requested pool', () => {
    const stats = [
      summariseTarget(target('a'), samplesFor('a', 'w1', [0, 10, 10, 10])),
      summariseTarget(target('b'), samplesFor('b', 'w1', [0, 100, 100, 100])),
      summariseTarget(target('c'), samplesFor('c', 'w1', [0, 900, 900, 900])),
    ];
    expect(medianOfTargetMedians(stats, ['a', 'b'])).toBe(55);
  });
});

describe('summariseWaypoint', () => {
  it('counts only the samples taken at that spot', () => {
    const targets = [target('a'), target('b')];
    const samples = [
      ...samplesFor('a', 'w1', [0, 10, 10, 10]),
      ...samplesFor('b', 'w1', [0, 20, 20, 20]),
      ...samplesFor('a', 'w2', [500, 500, 500], 5),
    ];

    const w1 = summariseWaypoint(waypoint('w1'), targets, samples);
    expect(w1.attempted).toBe(8);
    expect(w1.answered).toBe(8);
    expect(w1.rounds).toBe(4);
    expect(w1.medianOfTargetMediansMs).toBe(15);
    expect(w1.pooledTargetIds).toEqual(['a', 'b']);
  });

  it('reports a spot where a destination stopped answering', () => {
    const targets = [target('a'), target('b')];
    const samples = [
      ...samplesFor('a', 'w2', [40, 40, 40], 5),
      ...samplesFor('b', 'w2', [null, null, null], 5),
    ];

    const w2 = summariseWaypoint(waypoint('w2'), targets, samples);
    expect(w2.attempted).toBe(6);
    expect(w2.answered).toBe(3);
    // Only 'a' has a median, so only 'a' is in the pool — the figure must not
    // silently become "the median of everything that happened to answer".
    expect(w2.pooledTargetIds).toEqual(['a']);
    expect(w2.medianOfTargetMediansMs).toBe(40);
  });
});

describe('buildWalkConclusions', () => {
  it('says nothing at all when nothing was measured', () => {
    const targets = [target('a')];
    const perTarget = targets.map((t) => summariseTarget(t, []));
    const perWaypoint = [summariseWaypoint(waypoint('w1'), targets, [])];

    // The important half of this assertion is that it is not "all clear".
    expect(buildWalkConclusions(perTarget, perWaypoint)).toEqual([]);
  });

  it('names destinations that never answered', () => {
    const targets = [target('a'), target('b')];
    const samples = [
      ...samplesFor('a', 'w1', [10, 10, 10, 10]),
      ...samplesFor('b', 'w1', [null, null, null, null]),
    ];
    const lines = buildWalkConclusions(
      targets.map((t) => summariseTarget(t, samples)),
      [summariseWaypoint(waypoint('w1'), targets, samples)],
    );

    expect(lines.join(' ')).toContain('B never answered');
    expect(lines.join(' ')).not.toContain('A never answered');
  });

  it('compares spots only over destinations that produced a median at both', () => {
    const targets = [target('a'), target('b'), target('c')];
    const samples = [
      // Two destinations answer everywhere and get slower at the far spot.
      ...samplesFor('a', 'near', [0, 10, 10, 10]),
      ...samplesFor('b', 'near', [0, 20, 20, 20]),
      ...samplesFor('a', 'far', [200, 200, 200], 5),
      ...samplesFor('b', 'far', [300, 300, 300], 5),
      // 'c' only answers at the near spot, so it must not enter the comparison.
      ...samplesFor('c', 'near', [0, 5, 5, 5]),
      ...samplesFor('c', 'far', [null, null, null], 5),
    ];
    const perTarget = targets.map((t) => summariseTarget(t, samples));
    const perWaypoint = [
      summariseWaypoint(waypoint('near'), targets, samples),
      summariseWaypoint(waypoint('far'), targets, samples),
    ];

    const text = buildWalkConclusions(perTarget, perWaypoint).join(' ');
    // Paired over {a, b}: near = median(10, 20) = 15, far = median(200, 300) = 250.
    // Including 'c' would drag the near figure to 10 and misstate the delta.
    expect(text).toContain('lowest at “near” (15 ms)');
    expect(text).toContain('highest at “far” (250 ms)');
    expect(text).toContain('2 destinations');
  });

  it('declines to compare spots when too few destinations answered at all of them', () => {
    const targets = [target('a'), target('b')];
    const samples = [
      ...samplesFor('a', 'near', [0, 10, 10, 10]),
      ...samplesFor('b', 'near', [0, 20, 20, 20]),
      ...samplesFor('a', 'far', [null, null, null], 5),
      ...samplesFor('b', 'far', [200, 200, 200], 5),
    ];
    const perTarget = targets.map((t) => summariseTarget(t, samples));
    const perWaypoint = [
      summariseWaypoint(waypoint('near'), targets, samples),
      summariseWaypoint(waypoint('far'), targets, samples),
    ];

    expect(buildWalkConclusions(perTarget, perWaypoint).join(' ')).toContain(
      'cannot be compared to each other',
    );
  });

  it('blames the destination, not a spot, when the loss rate is the same everywhere', () => {
    // A destination that is unreachable from anywhere loses probes at an
    // identical rate at every spot. Naming whichever spot sorted first would
    // send someone to re-survey a corridor over a problem that is not there.
    const targets = [target('a'), target('b')];
    const samples = [
      ...samplesFor('a', 'near', [0, 10, 10, 10]),
      ...samplesFor('b', 'near', [null, null, null, null]),
      ...samplesFor('a', 'far', [12, 12, 12, 12], 5),
      ...samplesFor('b', 'far', [null, null, null, null], 5),
    ];
    const perTarget = targets.map((t) => summariseTarget(t, samples));
    const perWaypoint = [
      summariseWaypoint(waypoint('near'), targets, samples),
      summariseWaypoint(waypoint('far'), targets, samples),
    ];

    const text = buildWalkConclusions(perTarget, perWaypoint).join(' ');
    expect(text).toContain('at much the same rate at every spot — B');
    expect(text).not.toContain('had the most unanswered probes');
  });

  it('points at the spot with the most unanswered probes', () => {
    const targets = [target('a')];
    const samples = [
      ...samplesFor('a', 'good', [0, 10, 10, 10]),
      ...samplesFor('a', 'deadspot', [null, null, 30, null], 5),
    ];
    const perTarget = targets.map((t) => summariseTarget(t, samples));
    const perWaypoint = [
      summariseWaypoint(waypoint('good'), targets, samples),
      summariseWaypoint(waypoint('deadspot'), targets, samples),
    ];

    expect(buildWalkConclusions(perTarget, perWaypoint).join(' ')).toContain(
      '“deadspot” had the most unanswered probes: 3 of 4',
    );
  });
});

describe('buildWalkResult', () => {
  const targets = [target('a'), target('b', 'business')];

  it('produces an empty, honest record when no round ran', () => {
    const result = buildWalkResult({
      targets,
      waypoints: [waypoint('w1')],
      samples: [],
      intervalMs: 3000,
      durationMs: 0,
    });

    expect(result.rounds).toBe(0);
    expect(result.conclusions).toEqual([]);
    expect(result.perTarget.every((t) => t.summary.medianMs === null)).toBe(true);
    expect(result.failures.map((f) => f.reason)).toEqual(['not-attempted', 'not-attempted']);
  });

  it('records a destination that answered nothing as unreachable, not as zero', () => {
    const samples = [
      ...samplesFor('a', 'w1', [0, 10, 10, 10]),
      ...samplesFor('b', 'w1', [null, null, null, null]),
    ];
    const result = buildWalkResult({
      targets,
      waypoints: [waypoint('w1')],
      samples,
      intervalMs: 3000,
      durationMs: 12_000,
    });

    const b = result.perTarget.find((t) => t.targetId === 'b');
    expect(b?.summary.medianMs).toBeNull();
    expect(b?.summary.answered).toBe(0);
    expect(result.failures.find((f) => f.metric === 'b')?.reason).toBe('api-unreachable');
  });

  it('explains an absent median that came from too few answers', () => {
    const samples = [...samplesFor('a', 'w1', [0, 10]), ...samplesFor('b', 'w1', [0, 10, 10, 10])];
    const result = buildWalkResult({
      targets,
      waypoints: [waypoint('w1')],
      samples,
      intervalMs: 3000,
      durationMs: 6000,
    });

    expect(result.failures.find((f) => f.metric === 'a')?.reason).toBe('insufficient-samples');
    expect(result.failures.find((f) => f.metric === 'b')).toBeUndefined();
  });

  it('truncates stored samples loudly, and after the statistics are computed', () => {
    const times = Array.from({ length: MAX_STORED_SAMPLES + 50 }, () => 40);
    const samples = samplesFor('a', 'w1', times);
    const result = buildWalkResult({
      targets: [target('a')],
      waypoints: [waypoint('w1')],
      samples,
      intervalMs: 2000,
      durationMs: 1000,
    });

    expect(result.samples).toHaveLength(MAX_STORED_SAMPLES);
    expect(result.samplesDropped).toBe(50);
    // The count in the summary is the real one, not the truncated one.
    expect(result.perTarget[0].summary.attempted).toBe(MAX_STORED_SAMPLES + 50);
  });
});

describe('WALK_TARGETS', () => {
  it('has unique ids and https endpoints only', () => {
    const ids = WALK_TARGETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // A page served over https cannot open a plaintext connection at all, so a
    // http: target here would be a permanently dead row.
    expect(WALK_TARGETS.every((t) => t.url.startsWith('https://'))).toBe(true);
  });

  it('covers both consumer and business destinations', () => {
    expect(WALK_TARGETS.some((t) => t.category === 'consumer')).toBe(true);
    expect(WALK_TARGETS.some((t) => t.category === 'business')).toBe(true);
  });

  it('probes a terminal URL, not one that redirects', () => {
    // A `no-cors` request must follow redirects — the browser rejects any other
    // redirect mode outright — so a bouncing URL would fold two round trips into
    // one number. This is a reminder to re-check by hand, not a network test.
    const bouncers = ['https://outlook.office365.com/robots.txt', 'https://www.office.com/robots.txt'];
    expect(WALK_TARGETS.every((t) => !bouncers.includes(t.url))).toBe(true);
  });

  it('probes each target on its declared host', () => {
    for (const t of WALK_TARGETS) {
      expect(new URL(t.url).hostname).toBe(t.host);
    }
  });

  it('describes every target, so the disclosure list stays complete', () => {
    expect(WALK_TARGETS.every((t) => t.note.trim().length > 0)).toBe(true);
  });
});

describe('createWaypoint', () => {
  it('numbers an unnamed spot rather than leaving it blank', () => {
    expect(createWaypoint('   ', 3).label).toBe('Spot 3');
  });

  it('keeps a name the user typed', () => {
    expect(createWaypoint('  Back bedroom ', 2).label).toBe('Back bedroom');
  });
});
