import type {
  MeasurementFailure,
  WalkSample,
  WalkTarget,
  WalkTargetStats,
  WalkTestResult,
  WalkTimingSummary,
  WalkWaypoint,
  WalkWaypointStats,
} from '../types';
import {
  MIN_SAMPLES_FOR_SUMMARY,
  createId,
  meanConsecutiveDelta,
  median,
  summariseSamples,
  timeoutSignal,
} from './network';

/**
 * Walk & Test — repeated reachability probes to a fixed set of destinations,
 * tagged with the spot you were standing in when they were taken.
 *
 * The idea is borrowed from Richard Astbury's Azure Speed Test, which times a
 * fixed list of Azure regions over and over and lets the table settle. The
 * difference here is that you are expected to move: you name a spot, let a few
 * rounds run, walk somewhere else, name that spot, and at the end you have a
 * per-spot comparison rather than one number for "the network".
 *
 * What each number actually is, stated once here and again on screen:
 *
 *   - A **full HTTPS request round trip** from this browser to the destination's
 *     nearest edge. It is not an ICMP ping, and it is not comparable to one. A
 *     browser has no raw sockets, so there is no lower-level timing available.
 *   - Measured with `no-cors`, so the response is opaque by construction. A
 *     completed request proves the edge answered; it says nothing about *what*
 *     it answered. Reachability and timing only — never an HTTP status.
 *   - Redirects are followed, because a `no-cors` request is not permitted to do
 *     anything else: the Fetch spec pins redirect mode to `follow` for that mode
 *     and the browser rejects the call outright otherwise. That would let a
 *     redirect chain fold two round trips into one number, so every URL below
 *     was checked to return a terminal response — a 204, a 200, a 405 or a 401
 *     — rather than a bounce. (`outlook.office365.com/robots.txt` redirects to
 *     `/owa/robots.txt`; the probe therefore asks for the destination directly.)
 *   - The first sample against each destination pays for DNS, TCP and TLS. It is
 *     kept, flagged, and excluded from the summary statistics, in the same way
 *     the DNS benchmark discards its warm-up query.
 *
 * A round fires all destinations concurrently so every one of them describes the
 * same instant — which matters when the measuring device is moving. The cost is
 * that on a constrained link they compete with each other, which inflates all of
 * them together. That trade is stated in the UI rather than hidden.
 */

/** Per-probe timeout. A destination that has not answered in this long is
 *  recorded as no-response; the round must not stall behind it. */
export const PROBE_TIMEOUT_MS = 5000;

/** Gap between rounds. Short enough to follow you across a building, long
 *  enough that the tool is not itself the load. */
export const DEFAULT_INTERVAL_MS = 3000;

/**
 * Gap between rounds, not a fixed cadence: the loop waits for every destination
 * in a round to answer or time out before it starts the timer. A round in which
 * everything times out therefore takes `PROBE_TIMEOUT_MS`, and the effective
 * tick stretches to match rather than requests piling up on a struggling link.
 * That back-pressure is what makes the sub-second options safe for the browser.
 *
 * It does not make them polite. At a quarter-second gap a ten-minute walk is
 * well over a thousand requests to each of ten third parties, which is a
 * different kind of cost from the one the browser pays — see
 * `SUB_SECOND_INTERVAL_MS` and the notice the UI shows when one is selected.
 */
export const INTERVAL_CHOICES = [250, 500, 1000, 2000, 3000, 5000, 10000] as const;

/**
 * Rounds discarded from every timing statistic and every chart at the start of
 * a walk.
 *
 * The first probe to each destination pays for DNS, TCP and TLS, and the second
 * often still pays for a cold path somewhere upstream. Left in, those rounds set
 * the top of the chart's y-axis for the rest of the session, so the real
 * measurements are squashed into a flat line near the bottom and the graph never
 * recovers. They are counted, kept, and shown as discarded rather than deleted,
 * because a destination that failed during warm-up still failed.
 */
export const WARMUP_ROUNDS = 2;

/**
 * At or below this gap, the walk is generating sustained traffic to ten third
 * parties rather than sampling them, and the UI says so.
 *
 * A quarter-second gap resolves to roughly three rounds a second once each
 * round's own duration is added, so ten minutes is on the order of 1,800
 * requests per destination. Nothing breaks, and several of these operators run
 * bot protection that may reasonably start refusing — which would then show up
 * on the cards as a dead destination that is really a rate limit. Worth
 * knowing before reading the result.
 */
export const SUB_SECOND_INTERVAL_MS = 500;

/**
 * Rounds visible in the live charts. A single bad spike would otherwise hold the
 * y-axis at its height for the rest of the walk. The tables and the saved record
 * always cover the whole walk; this trims the view, not the data, and the chart
 * says which window it is showing.
 */
export const CHART_WINDOW_ROUNDS = 60;

/**
 * Raw samples kept in the saved record.
 *
 * A long walk produces thousands, and `localStorage` is a few MB for the whole
 * origin. Aggregates are computed over every sample before truncation and are
 * never affected by it; the count that was dropped is stored and shown, because
 * silent truncation is a lie by omission.
 */
export const MAX_STORED_SAMPLES = 500;

/**
 * The destinations.
 *
 * A combined consumer and business list, chosen so that a failure means
 * something to whoever is holding the phone: five places people go at home and
 * five that a workday stops without. Where a site publishes a purpose-built
 * connectivity endpoint (Google's and YouTube's `generate_204`) that is used,
 * because it is the cheapest thing those hosts serve. Everywhere else the probe
 * is `/robots.txt`, which every one of these publishes, is a few hundred bytes,
 * and is served from the same edge as the rest of the site.
 *
 * These are front doors — the CDN or front-end edge that terminates TLS near
 * you. They are not the streaming, media or API backends those services use once
 * you are logged in (Netflix Open Connect, the Teams media relays), and a
 * browser cannot reach those at all. The UI says so.
 *
 * Requests carry no cookies: `credentials: 'omit'` is set on every probe, so
 * these hosts see an IP and a TLS handshake, not a logged-in user.
 */
export const WALK_TARGETS: readonly WalkTarget[] = [
  {
    id: 'google',
    label: 'Google',
    category: 'consumer',
    host: 'www.google.com',
    url: 'https://www.google.com/generate_204',
    note: 'Google’s own connectivity endpoint — an empty 204, the cheapest response it serves.',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    category: 'consumer',
    host: 'www.youtube.com',
    url: 'https://www.youtube.com/generate_204',
    note: 'YouTube’s connectivity endpoint. The page edge, not the video CDN that serves streams.',
  },
  {
    id: 'netflix',
    label: 'Netflix',
    category: 'consumer',
    host: 'www.netflix.com',
    url: 'https://www.netflix.com/robots.txt',
    note: 'Netflix’s web front door. Playback runs on Open Connect appliances a browser cannot address.',
  },
  {
    id: 'amazon',
    label: 'Amazon',
    category: 'consumer',
    host: 'www.amazon.com',
    url: 'https://www.amazon.com/robots.txt',
    note: 'Amazon’s retail edge.',
  },
  {
    id: 'm365',
    label: 'Microsoft 365',
    category: 'business',
    host: 'outlook.office365.com',
    url: 'https://outlook.office365.com/owa/robots.txt',
    note:
      'The Exchange Online front door Outlook itself talks to, rather than the office.com portal. ' +
      'It answers an unauthenticated probe with a 401 from the edge, which is a round trip like ' +
      'any other.',
  },
  {
    id: 'teams',
    label: 'Microsoft Teams',
    category: 'business',
    host: 'teams.microsoft.com',
    url: 'https://teams.microsoft.com/robots.txt',
    note: 'The Teams signalling edge. Call audio and video use separate relays over UDP, out of reach here.',
  },
  {
    id: 'zoom',
    label: 'Zoom',
    category: 'business',
    host: 'zoom.us',
    url: 'https://zoom.us/robots.txt',
    note: 'Zoom’s web edge. Meeting media, again, goes somewhere a page cannot follow.',
  },
  {
    id: 'salesforce',
    label: 'Salesforce',
    category: 'business',
    host: 'login.salesforce.com',
    url: 'https://login.salesforce.com/robots.txt',
    note: 'The Salesforce login edge — the first thing an org hits every morning.',
  },
  {
    id: 'slack',
    label: 'Slack',
    category: 'business',
    host: 'slack.com',
    url: 'https://slack.com/robots.txt',
    note: 'Slack’s web edge. The message socket is a separate WebSocket host.',
  },
  {
    id: 'atlassian',
    label: 'Atlassian',
    category: 'business',
    host: 'www.atlassian.com',
    url: 'https://www.atlassian.com/robots.txt',
    note:
      'Jira and Confluence. Replaced Facebook here because Meta domains sit on most ad and ' +
      'tracker blocklists, so that row failed for people whose network was fine — a false alarm ' +
      'is worse than no row. Atlassian also rides a different edge network from anything else ' +
      'in this list, which is worth having.',
  },
];

/** Blank summary, used when a destination has produced nothing yet. Every
 *  statistic is null rather than zero: no samples is not "zero milliseconds". */
export const EMPTY_SUMMARY: WalkTimingSummary = {
  answered: 0,
  attempted: 0,
  medianMs: null,
  p95Ms: null,
  minMs: null,
  maxMs: null,
  stdDevMs: null,
};

/**
 * One probe.
 *
 * Never rejects: a failure is a result. `no-response` covers a timeout, a DNS
 * failure, a TLS failure, a blocked destination and being out of range, and a
 * browser cannot tell those apart — so the field is called `outcome`, not
 * `packetLoss`, and the UI does not claim to know which one happened.
 */
export async function probeWalkTarget(
  target: WalkTarget,
  options: {
    round: number;
    waypointId: string;
    /** Whether this is the first probe to this destination that comes back. Set
     *  by the caller once the outcome is known — see `runWalkLoop`. */
    connectionSetup?: boolean;
    signal?: AbortSignal | undefined;
  },
): Promise<WalkSample> {
  const separator = target.url.includes('?') ? '&' : '?';
  const url = `${target.url}${separator}_nr=${Date.now()}_${options.round}`;
  const started = performance.now();
  const gate = timeoutSignal(PROBE_TIMEOUT_MS, options.signal);

  const base: Omit<WalkSample, 'roundTripMs' | 'outcome'> = {
    targetId: target.id,
    waypointId: options.waypointId,
    round: options.round,
    timestamp: Date.now(),
    connectionSetup: options.connectionSetup === true,
  };

  try {
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      // No `redirect` option: `no-cors` requires the default `follow`, and
      // Chrome rejects the call before it reaches the network otherwise. The
      // targets are chosen to answer terminally — see the module comment.
      signal: gate.signal,
    });
    return { ...base, roundTripMs: Math.round(performance.now() - started), outcome: 'answered' };
  } catch {
    return { ...base, roundTripMs: null, outcome: 'no-response' };
  } finally {
    gate.done();
  }
}

export interface WalkLoopOptions {
  targets?: readonly WalkTarget[];
  intervalMs?: number;
  /** Read at the start of every round, so moving to a new spot mid-walk tags
   *  subsequent rounds without restarting anything. */
  currentWaypointId: () => string;
  onRound: (samples: WalkSample[], round: number) => void;
  signal: AbortSignal;
}

/**
 * Runs rounds until the caller aborts.
 *
 * Deliberately not a React hook and not a class: the loop is the measurement,
 * and keeping it here means the component cannot accidentally change what is
 * measured by re-rendering.
 */
export async function runWalkLoop(options: WalkLoopOptions): Promise<void> {
  const targets = options.targets ?? WALK_TARGETS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  // Destinations whose first answer has already come back. The handshake cost
  // sits in the first probe that *completes*, not the first one attempted: a
  // destination that is unreachable for twenty rounds and then answers pays for
  // DNS, TCP and TLS on round twenty-one, and that sample has to be flagged.
  const connected = new Set<string>();
  let round = 0;

  while (!options.signal.aborted) {
    round += 1;
    const waypointId = options.currentWaypointId();

    const samples = await Promise.all(
      targets.map(async (target) => {
        const sample = await probeWalkTarget(target, {
          round,
          waypointId,
          signal: options.signal,
        });
        if (sample.outcome === 'answered' && !connected.has(target.id)) {
          connected.add(target.id);
          return { ...sample, connectionSetup: true };
        }
        return sample;
      }),
    );

    if (options.signal.aborted) break;
    options.onRound(samples, round);

    // Interval, interruptible. A plain sleep would leave the stop button feeling
    // broken for up to ten seconds on the slowest setting.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, intervalMs);
      function finish() {
        clearTimeout(timer);
        options.signal.removeEventListener('abort', finish);
        resolve();
      }
      options.signal.addEventListener('abort', finish);
    });
  }
}

/**
 * Whether a sample's timing is usable as a steady-state measurement.
 *
 * Two exclusions, both about connection setup rather than about the network:
 * the opening `WARMUP_ROUNDS` of the walk, and the first probe each destination
 * answers, which is where its DNS, TCP and TLS cost lands. Exported because the
 * charts must draw exactly what the statistics count, or the picture and the
 * table disagree.
 */
export const isSteadyState = (sample: WalkSample): boolean =>
  sample.outcome === 'answered' &&
  sample.roundTripMs !== null &&
  !sample.connectionSetup &&
  sample.round > WARMUP_ROUNDS;

const steadyStateTimings = (samples: readonly WalkSample[]): number[] =>
  samples.filter(isSteadyState).map((s) => s.roundTripMs as number);

/**
 * Per-destination statistics over a set of samples.
 *
 * `attempted` and `answered` count every sample including the setup one — a
 * destination that answered only its first probe and nothing since should not
 * read as though it was never tried. The timing columns exclude it.
 */
export function summariseTarget(
  target: WalkTarget,
  samples: readonly WalkSample[],
): WalkTargetStats {
  const mine = samples.filter((s) => s.targetId === target.id);
  const timings = steadyStateTimings(mine);
  const summary = summariseSamples(timings);
  const last = mine.length > 0 ? mine[mine.length - 1] : null;

  return {
    targetId: target.id,
    label: target.label,
    category: target.category,
    summary: {
      answered: mine.filter((s) => s.outcome === 'answered').length,
      attempted: mine.length,
      medianMs: summary.medianMs,
      p95Ms: summary.p95Ms,
      minMs: summary.minMs,
      maxMs: summary.maxMs,
      stdDevMs: summary.stdDevMs,
    },
    // Jitter over consecutive answered probes. Null below two samples, because
    // the variation across a single measurement is not small — it is absent.
    jitterMs: meanConsecutiveDelta(timings),
    lastRoundTripMs: last === null ? null : last.roundTripMs,
    lastOutcome: last === null ? null : last.outcome,
  };
}

/**
 * Median of the per-destination medians, over an explicit pool.
 *
 * Pooling every raw sample instead would make this figure move when a
 * destination drops out, because the mix of destinations changed rather than
 * the network. Taking one median per destination and then a median of those
 * keeps every destination weighted equally, and the pool it was computed over
 * travels with the number so two spots are only ever compared over the
 * destinations that produced a median at both.
 */
export function medianOfTargetMedians(
  stats: readonly WalkTargetStats[],
  pool?: readonly string[],
): number | null {
  const eligible = stats.filter(
    (s) => s.summary.medianMs !== null && (pool === undefined || pool.includes(s.targetId)),
  );
  if (eligible.length === 0) return null;
  const value = median(eligible.map((s) => s.summary.medianMs as number));
  return value === null ? null : Math.round(value);
}

/** Per-spot statistics. */
export function summariseWaypoint(
  waypoint: WalkWaypoint,
  targets: readonly WalkTarget[],
  samples: readonly WalkSample[],
): WalkWaypointStats {
  const mine = samples.filter((s) => s.waypointId === waypoint.id);
  const perTarget = targets.map((t) => summariseTarget(t, mine));

  return {
    waypointId: waypoint.id,
    label: waypoint.label,
    attempted: mine.length,
    answered: mine.filter((s) => s.outcome === 'answered').length,
    rounds: new Set(mine.map((s) => s.round)).size,
    perTarget,
    medianOfTargetMediansMs: medianOfTargetMedians(perTarget),
    pooledTargetIds: perTarget
      .filter((s) => s.summary.medianMs !== null)
      .map((s) => s.targetId),
  };
}

/**
 * How much worse one spot's loss rate has to be than the best spot's before the
 * conclusions single it out: five percentage points.
 *
 * A judgement, not a measurement. Below it the spots are treated as losing
 * probes at the same rate, which is the honest reading of a destination that is
 * unreachable from everywhere rather than of a bad corner.
 */
export const LOSS_RATE_DIFFERENCE = 0.05;

/** Ordinal for "N of M", written out so a reader is not left to divide. */
const missed = (stats: { answered: number; attempted: number }): number =>
  stats.attempted - stats.answered;

/**
 * Plain-English findings, in the spirit of GRC's "Conclusions" tab.
 *
 * Pure and total: no samples means an empty list, never "everything looks
 * fine". Silence here is silence, not a clean bill of health — the same rule the
 * rules engine applies to `no-fault-found`.
 */
export function buildWalkConclusions(
  perTarget: readonly WalkTargetStats[],
  perWaypoint: readonly WalkWaypointStats[],
): string[] {
  const lines: string[] = [];
  const totalAttempted = perTarget.reduce((sum, t) => sum + t.summary.attempted, 0);
  if (totalAttempted === 0) return lines;

  // 1. Destinations that never answered at all.
  const silent = perTarget.filter((t) => t.summary.attempted > 0 && t.summary.answered === 0);
  if (silent.length > 0) {
    lines.push(
      `${silent.map((t) => t.label).join(', ')} never answered during this walk. That is not ` +
        'proof the destination is down — a browser cannot separate a blocked host, a failed ' +
        'name lookup and a dropped connection — but every other destination was tried the same ' +
        'way at the same moments.',
    );
  }

  // 2. Destinations that answered sometimes.
  const intermittent = perTarget
    .filter((t) => t.summary.answered > 0 && missed(t.summary) > 0)
    .sort((a, b) => missed(b.summary) - missed(a.summary));
  if (intermittent.length > 0) {
    const worst = intermittent[0];
    lines.push(
      `${worst.label} missed ${missed(worst.summary)} of ${worst.summary.attempted} probes` +
        (intermittent.length > 1
          ? `, and ${intermittent.length - 1} other destination${
              intermittent.length === 2 ? '' : 's'
            } dropped probes too.`
          : '.'),
    );
  }

  // 3. Spot-to-spot comparison, paired over the destinations that produced a
  //    median at both spots. Comparing unpaired figures would report a change in
  //    which destinations answered as though it were a change in latency.
  const comparable = perWaypoint.filter((w) => w.pooledTargetIds.length > 0);
  if (comparable.length >= 2) {
    let best: { label: string; value: number } | null = null;
    let worst: { label: string; value: number } | null = null;
    let poolSize = 0;

    const shared = comparable.reduce<string[]>(
      (pool, w) => pool.filter((id) => w.pooledTargetIds.includes(id)),
      [...comparable[0].pooledTargetIds],
    );

    if (shared.length >= 2) {
      poolSize = shared.length;
      for (const w of comparable) {
        const value = medianOfTargetMedians(w.perTarget, shared);
        if (value === null) continue;
        if (best === null || value < best.value) best = { label: w.label, value };
        if (worst === null || value > worst.value) worst = { label: w.label, value };
      }
    }

    if (best !== null && worst !== null && best.label !== worst.label) {
      lines.push(
        `Round trips were lowest at “${best.label}” (${best.value} ms) and highest at ` +
          `“${worst.label}” (${worst.value} ms), comparing the ${poolSize} destinations that ` +
          'produced a median at every spot. Each figure is the median of those destinations’ ' +
          'own medians, so it does not move when a destination drops out.',
      );
    } else if (shared.length >= 2) {
      lines.push(
        `Every spot produced the same median round trip across the ${poolSize} destinations ` +
          'measured at all of them, so nothing here separates them.',
      );
    } else {
      lines.push(
        'The spots cannot be compared to each other: fewer than two destinations produced a ' +
          'median at every one of them. Spend longer at each spot, or drop the ones that are ' +
          'not answering.',
      );
    }
  }

  // 4. Where the unanswered probes were.
  //
  // Naming the worst spot is only meaningful when the spots actually differ. A
  // destination that is unreachable everywhere produces an identical loss rate
  // at every spot, and pointing at whichever one happened to sort first would
  // send someone to re-survey a corridor over a problem that has nothing to do
  // with where they were standing.
  const probed = perWaypoint.filter((w) => w.attempted > 0);
  const totalMissed = probed.reduce((sum, w) => sum + missed(w), 0);
  if (totalMissed > 0) {
    const rate = (w: WalkWaypointStats): number => missed(w) / w.attempted;
    const ranked = [...probed].sort((a, b) => rate(b) - rate(a));
    const worst = ranked[0];
    const spread = rate(worst) - rate(ranked[ranked.length - 1]);

    // Which destinations account for the misses, so the reader chases the right
    // thing — a bad corner and a dead destination are different problems.
    const blameFor = (stats: readonly WalkTargetStats[]): string => {
      const names = stats
        .filter((t) => missed(t.summary) > 0)
        .sort((a, b) => missed(b.summary) - missed(a.summary))
        .map((t) => t.label);
      return names.length === 0 ? '' : ` — ${names.join(', ')}`;
    };

    if (probed.length >= 2 && spread >= LOSS_RATE_DIFFERENCE) {
      lines.push(
        `“${worst.label}” had the most unanswered probes: ${missed(worst)} of ` +
          `${worst.attempted}${blameFor(worst.perTarget)}. On a walk test that is usually the ` +
          'signal worth chasing — a spot where connections stop completing, rather than one ' +
          'where they are merely slower.',
      );
    } else {
      const totalAttempted = probed.reduce((sum, w) => sum + w.attempted, 0);
      lines.push(
        `${totalMissed} of ${totalAttempted} probes went unanswered, at much the same rate at ` +
          `every spot${blameFor(perTarget)}. That points at the destination rather than at where ` +
          'you were standing.',
      );
    }
  }

  return lines;
}

/**
 * Assembles the finished record from everything collected during the walk.
 *
 * Pure: it takes the samples and returns the result, so the whole aggregation
 * path is testable without a network or a clock. The caller supplies the elapsed
 * time it measured.
 */
export function buildWalkResult(input: {
  targets: readonly WalkTarget[];
  waypoints: readonly WalkWaypoint[];
  samples: readonly WalkSample[];
  intervalMs: number;
  durationMs: number;
}): WalkTestResult {
  const { targets, waypoints, samples, intervalMs, durationMs } = input;
  const perTarget = targets.map((t) => summariseTarget(t, samples));
  const perWaypoint = waypoints.map((w) => summariseWaypoint(w, targets, samples));
  const rounds = new Set(samples.map((s) => s.round)).size;

  const failures: MeasurementFailure[] = [];
  for (const stats of perTarget) {
    if (stats.summary.attempted === 0) {
      failures.push({
        metric: stats.targetId,
        reason: 'not-attempted',
        detail: `${stats.label} was not probed during this walk.`,
      });
      continue;
    }
    if (stats.summary.answered === 0) {
      failures.push({
        metric: stats.targetId,
        reason: 'api-unreachable',
        detail:
          `${stats.label} did not answer any of its ${stats.summary.attempted} probes, so it has ` +
          'no round-trip time. A browser cannot tell a blocked destination from an unreachable ' +
          'one.',
      });
      continue;
    }
    if (stats.summary.medianMs === null) {
      failures.push({
        metric: stats.targetId,
        reason: 'insufficient-samples',
        detail:
          `${stats.label} produced ${stats.summary.answered} answer` +
          `${stats.summary.answered === 1 ? '' : 's'}, and two of those are set aside: the ` +
          `opening ${WARMUP_ROUNDS} rounds of the walk, and the first answer from this ` +
          `destination, both of which carry DNS and TLS setup. At least ` +
          `${MIN_SAMPLES_FOR_SUMMARY} steady-state answers are needed before a median is ` +
          'reported.',
      });
    }
  }

  // Newest samples are the ones worth keeping: a walk ends where the problem is.
  const kept = samples.slice(Math.max(0, samples.length - MAX_STORED_SAMPLES));

  return {
    id: createId('walktest'),
    timestamp: Date.now(),
    targets: [...targets],
    waypoints: [...waypoints],
    samples: kept,
    samplesDropped: samples.length - kept.length,
    rounds,
    perTarget,
    perWaypoint,
    conclusions: buildWalkConclusions(perTarget, perWaypoint),
    intervalMs,
    durationMs,
    failures,
  };
}

/** What `navigator.connection` reports, if anything. Reported by the browser
 *  rather than measured, labelled as such everywhere it is shown, and never
 *  used to fill in a missing measurement. */
export function readReportedConnection(): {
  reportedConnectionType: string | null;
  reportedEffectiveType: string | null;
} {
  const conn = (navigator as unknown as { connection?: { type?: string; effectiveType?: string } })
    .connection;
  return {
    reportedConnectionType: conn?.type ?? null,
    reportedEffectiveType: conn?.effectiveType ?? null,
  };
}

/** A new spot. Blank names get a numbered placeholder rather than an empty
 *  column header. */
export function createWaypoint(label: string, index: number): WalkWaypoint {
  const trimmed = label.trim();
  return {
    id: createId('waypoint'),
    label: trimmed.length > 0 ? trimmed : `Spot ${index}`,
    startedAt: Date.now(),
    endedAt: null,
    ...readReportedConnection(),
  };
}
