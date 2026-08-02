import type { NetReadyScore, PingResult, SpeedTestResult } from '../types';
import { calculateNetReadyScore } from '../utils/network';
import { THRESHOLDS } from './rules';
import type { Evidence } from './types';

/**
 * Bottleneck attribution.
 *
 * A grade on its own is not an answer. "B" tells a user nothing about what to
 * change; "the binding constraint is bufferbloat, not bandwidth" tells them
 * exactly what to change and what not to bother with.
 *
 * The method is sensitivity analysis over the existing scoring function. For
 * each input that was actually measured, the score is recomputed with that one
 * input raised to a reference level and everything else left exactly as
 * measured. Whichever substitution lifts the score furthest is the input
 * holding it down.
 *
 * The reference values below are hypotheticals used inside this calculation and
 * nowhere else. They are never stored, never exported and never rendered as a
 * measurement — the only thing that leaves this module is the *name* of the
 * limiting input and the real measured value of it. That distinction is the
 * whole reason this is safe: substituting a value to answer "what if" is
 * analysis; substituting a value to fill a gap in a report is fabrication.
 */

export type ConstraintInput = 'bufferbloat' | 'download' | 'upload' | 'latency' | 'jitter';

/**
 * "Good enough that this input is no longer what limits the result."
 *
 * Not typical values, not targets — ceilings past which raising the input
 * further stops changing the outcome. Internal to the sensitivity calculation.
 */
const REFERENCE = {
  downloadMbps: 200,
  uploadMbps: 40,
  latencyMs: 15,
  jitterMs: 2,
} as const;

/** Presentation order, and the deterministic tie-break when two inputs would
 *  gain the score the same amount. */
const INPUT_ORDER: ConstraintInput[] = ['bufferbloat', 'download', 'latency', 'jitter', 'upload'];

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const INPUT_LABELS: Record<ConstraintInput, string> = {
  bufferbloat: 'bufferbloat',
  download: 'download bandwidth',
  upload: 'upload bandwidth',
  latency: 'latency',
  jitter: 'jitter',
};

export interface Sensitivity {
  input: ConstraintInput;
  /** Points the overall score would gain if this input alone stopped limiting
   *  it. Zero when the measured value is already past the reference. */
  gain: number;
}

export interface BottleneckAttribution {
  /** The input that most constrains the result, or null when it cannot be
   *  identified from what was measured. */
  constraint: ConstraintInput | null;
  /** Short statement for the dashboard headline. Empty string is never
   *  returned; when there is no constraint this explains why. */
  headline: string;
  /** One or two sentences of supporting detail. */
  detail: string;
  evidence: Evidence[];
  /** Every input the analysis could weigh, strongest first. */
  sensitivities: Sensitivity[];
  /** Set when `constraint` is null. */
  unavailableReason: string | null;
}

/** Rebuilds a speed/ping pair with one field replaced, for the "what if" score.
 *  Nothing built here is ever returned to a caller. */
function scoreWith(
  speed: SpeedTestResult | null | undefined,
  ping: PingResult | null | undefined,
  override: Partial<Record<'download' | 'upload' | 'latency' | 'jitter', number>>,
): NetReadyScore | null {
  const nextSpeed: SpeedTestResult | null = speed
    ? {
        ...speed,
        downloadSpeed: override.download ?? speed.downloadSpeed,
        uploadSpeed: override.upload ?? speed.uploadSpeed,
        ping: override.latency ?? speed.ping,
        jitter: override.jitter ?? speed.jitter,
      }
    : null;

  const nextPing: PingResult | null = ping
    ? {
        ...ping,
        avgPing: override.latency ?? ping.avgPing,
        jitter: override.jitter ?? ping.jitter,
      }
    : null;

  return calculateNetReadyScore(nextSpeed, nextPing);
}

/**
 * Identifies the binding constraint on a measured result.
 *
 * Returns a null constraint — with a reason — whenever the measurements cannot
 * support the claim. That includes the case where everything measured is
 * already good: there is no bottleneck to name, and inventing one would be its
 * own small lie.
 */
export function attributeBottleneck(
  speed: SpeedTestResult | null | undefined,
  ping: PingResult | null | undefined,
  score: NetReadyScore | null,
): BottleneckAttribution {
  const empty = (reason: string): BottleneckAttribution => ({
    constraint: null,
    headline: 'No binding constraint identified',
    detail: reason,
    evidence: [],
    sensitivities: [],
    unavailableReason: reason,
  });

  if (score === null) {
    return empty(
      'Nothing has been measured yet, so there is no result for anything to be constraining.',
    );
  }

  const download = speed?.downloadSpeed ?? null;
  const upload = speed?.uploadSpeed ?? null;
  const latency = ping?.avgPing ?? speed?.ping ?? null;
  const jitter = ping?.jitter ?? speed?.jitter ?? null;
  const idlePing = speed?.ping ?? null;
  const loadedPing = speed?.loadedPing ?? null;

  const evidence: Evidence[] = [];
  const sensitivities: Sensitivity[] = [];

  const consider = (
    input: ConstraintInput,
    measured: number | null,
    reference: number,
    better: 'higher' | 'lower',
    override: Parameters<typeof scoreWith>[2],
  ) => {
    if (measured === null) return;
    const alreadyGood = better === 'higher' ? measured >= reference : measured <= reference;
    if (alreadyGood) {
      sensitivities.push({ input, gain: 0 });
      return;
    }
    const lifted = scoreWith(speed, ping, override);
    if (lifted === null) return;
    sensitivities.push({ input, gain: Math.max(0, lifted.overallScore - score.overallScore) });
  };

  consider('download', download, REFERENCE.downloadMbps, 'higher', {
    download: REFERENCE.downloadMbps,
  });
  consider('upload', upload, REFERENCE.uploadMbps, 'higher', { upload: REFERENCE.uploadMbps });
  consider('latency', latency, REFERENCE.latencyMs, 'lower', { latency: REFERENCE.latencyMs });
  consider('jitter', jitter, REFERENCE.jitterMs, 'lower', { jitter: REFERENCE.jitterMs });

  if (sensitivities.length === 0) {
    return empty(
      'The score exists, but none of the inputs it depends on were measured well enough to rank ' +
        'them against each other.',
    );
  }

  sensitivities.sort((a, b) => {
    if (b.gain !== a.gain) return b.gain - a.gain;
    return INPUT_ORDER.indexOf(a.input) - INPUT_ORDER.indexOf(b.input);
  });

  /**
   * Bufferbloat overrides the ranking when it is severe.
   *
   * It is deliberately not folded into `calculateNetReadyScore`, so sensitivity
   * analysis over that function cannot see it at all. Yet a link that adds a
   * tenth of a second of delay the moment it is used is limited by that, not by
   * its throughput — the score simply does not model the thing the user
   * actually experiences. This is the one place the ranking is overridden, the
   * threshold is the same one the bufferbloat rule uses, and the reason is
   * stated in the output rather than hidden.
   */
  if (idlePing !== null && loadedPing !== null) {
    const delta = Math.round(loadedPing - idlePing);
    if (delta >= THRESHOLDS.bufferbloatDeltaMs) {
      const runnerUp = sensitivities[0];
      return {
        constraint: 'bufferbloat',
        // "on the numbers" is doing real work in this headline. The score can
        // read A+ while the connection falls apart the moment anything uses it,
        // because `calculateNetReadyScore` has no bufferbloat term at all.
        // Without the qualifier the two halves of the sentence contradict each
        // other; with it, the divergence is the point.
        headline: `Grade ${score.grade} on the numbers — the binding constraint is bufferbloat, not bandwidth`,
        detail:
          `Latency rose from ${idlePing} ms idle to ${loadedPing} ms under load, an increase of ` +
          `${delta} ms. Everything real-time degrades at that point regardless of throughput, ` +
          `so this outranks ${INPUT_LABELS[runnerUp.input]} even though the score itself does not ` +
          'model it.',
        evidence: [
          { metric: 'speed.ping', observation: `${idlePing} ms idle` },
          { metric: 'speed.loadedPing', observation: `${loadedPing} ms under load` },
        ],
        sensitivities: [{ input: 'bufferbloat', gain: 0 }, ...sensitivities],
        unavailableReason: null,
      };
    }
  }

  const top = sensitivities[0];
  if (top.gain <= 0) {
    return {
      constraint: null,
      headline: `Grade ${score.grade} — nothing measured is holding this back`,
      detail:
        'Every input that was measured is already past the point where improving it would change ' +
        'the result. If something still feels slow, it is not in what this test covers.',
      evidence: [],
      sensitivities,
      unavailableReason:
        'No measured input is limiting the score, so there is no bottleneck to name.',
    };
  }

  const runnerUp = sensitivities.find((s) => s.input !== top.input && s.gain > 0);
  const measuredValue: Record<ConstraintInput, string> = {
    download: download === null ? '' : `${download} Mbps`,
    upload: upload === null ? '' : `${upload} Mbps`,
    latency: latency === null ? '' : `${latency} ms`,
    jitter: jitter === null ? '' : `${jitter} ms`,
    bufferbloat: '',
  };

  evidence.push({
    metric: `speed.${top.input}`,
    observation: `${INPUT_LABELS[top.input]} measured at ${measuredValue[top.input]}`,
  });
  if (runnerUp) {
    evidence.push({
      metric: `speed.${runnerUp.input}`,
      observation: `${INPUT_LABELS[runnerUp.input]} measured at ${measuredValue[runnerUp.input]}`,
    });
  }

  return {
    constraint: top.input,
    headline: `Grade ${score.grade} — the binding constraint is ${INPUT_LABELS[top.input]}`,
    detail:
      `${capitalise(INPUT_LABELS[top.input])} measured ${measuredValue[top.input]}. Fixing it ` +
      `alone would move the overall score by about ${top.gain} point${top.gain === 1 ? '' : 's'}` +
      (runnerUp
        ? `, against ${runnerUp.gain} for ${INPUT_LABELS[runnerUp.input]} — so that is where the ` +
          'effort goes.'
        : ', and nothing else measured is limiting it.'),
    evidence,
    sensitivities,
    unavailableReason: null,
  };
}

/** Label for a constraint, for use in UI copy. */
export function constraintLabel(input: ConstraintInput): string {
  return INPUT_LABELS[input];
}
