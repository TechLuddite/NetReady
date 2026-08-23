import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Footprints,
  Info,
  Loader2,
  MapPin,
  Play,
  Square,
  WifiOff,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  HistoryItem,
  WalkSample,
  WalkTarget,
  WalkTargetStats,
  WalkTestResult,
  WalkWaypoint,
} from '../types';
import {
  CHART_WINDOW_ROUNDS,
  DEFAULT_INTERVAL_MS,
  INTERVAL_CHOICES,
  MAX_STORED_SAMPLES,
  PROBE_TIMEOUT_MS,
  WALK_TARGETS,
  WARMUP_ROUNDS,
  buildWalkConclusions,
  buildWalkResult,
  createWaypoint,
  isSteadyState,
  runWalkLoop,
  summariseTarget,
  summariseWaypoint,
} from '../utils/walkTest';
import { MIN_SAMPLES_FOR_SUMMARY, median } from '../utils/network';
import { FailureNotice, MetricValue, displayMetric } from './MetricValue';
import { StorageFullError, saveHistoryItem } from '../utils/storage';

/**
 * Walk & Test.
 *
 * The screen has one job the rest of the suite does not: it has to stay
 * readable while the person holding the phone is looking at a wall socket
 * rather than at it. So the destination cards are the product, the aggregate
 * chart is secondary, and the single most important control — "I have moved,
 * start a new spot" — is a large button that never scrolls out of the way while
 * a walk is running.
 *
 * Two honesty rules cost more here than usual and are worth stating.
 *
 * A destination with no measurement shows an em-dash and no sparkline. A
 * flat line at the bottom of a latency card reads as "instant", which is the
 * exact opposite of what a dead spot means, so there is no line at all.
 *
 * Every sparkline shares one y-scale, printed above the grid. Per-card scaling
 * would make a 400 ms destination and a 40 ms destination draw identical
 * shapes, and the whole reason for putting ten cards side by side is to compare
 * them at a glance.
 */

interface WalkTestProps {
  onHistoryUpdate: () => void;
}

type SortKey = 'median' | 'last' | 'answered' | 'label';

const CATEGORY_BADGE: Record<'consumer' | 'business', string> = {
  consumer: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/25',
  business: 'bg-sky-500/15 text-sky-300 border-sky-500/25',
};

/** Latency bands, for colour only. Deliberately coarse and never shown as a
 *  grade: these are HTTPS round trips to third-party edges, and turning them
 *  into a letter would imply a precision the measurement does not have. */
const tone = (ms: number | null): string => {
  if (ms === null) return 'text-slate-600';
  if (ms < 100) return 'text-emerald-400';
  if (ms < 250) return 'text-cyan-300';
  if (ms < 600) return 'text-amber-300';
  return 'text-rose-300';
};

const strokeFor = (ms: number | null): string => {
  if (ms === null) return '#475569';
  if (ms < 100) return '#34d399';
  if (ms < 250) return '#22d3ee';
  if (ms < 600) return '#fbbf24';
  return '#fb7185';
};

const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

/** One point per round for one destination. `ms` is null for a round the
 *  destination did not answer, or one whose timing was discarded as warm-up. */
interface CardPoint {
  round: number;
  ms: number | null;
}

interface DestinationCardProps {
  target: WalkTarget | undefined;
  stats: WalkTargetStats;
  series: CardPoint[];
  /** Shared across every card so the shapes are comparable. Null when nothing
   *  has been measured yet, in which case no card draws a line. */
  yMax: number | null;
  hasStarted: boolean;
}

const DestinationCard: React.FC<DestinationCardProps> = ({
  target,
  stats,
  series,
  yMax,
  hasStarted,
}) => {
  const unanswered = stats.summary.attempted - stats.summary.answered;
  const dead = stats.summary.attempted > 0 && stats.summary.answered === 0;
  const plotted = yMax === null ? 0 : series.filter((p) => p.ms !== null).length;
  const stroke = strokeFor(stats.summary.medianMs ?? stats.lastRoundTripMs);
  const gradientId = `walkgrad_${stats.targetId}`;

  const lastFailure =
    stats.lastOutcome === 'no-response'
      ? {
          metric: stats.targetId,
          reason: 'api-unreachable' as const,
          detail: `The last probe to ${stats.label} did not come back.`,
        }
      : undefined;

  const summaryFailure =
    stats.summary.medianMs === null
      ? {
          metric: stats.targetId,
          reason: dead ? ('api-unreachable' as const) : ('insufficient-samples' as const),
          detail: dead
            ? `${stats.label} has not answered any probe.`
            : `${stats.label} needs ${MIN_SAMPLES_FOR_SUMMARY} answers after the warm-up rounds ` +
              'before a median means anything.',
        }
      : undefined;

  return (
    <div
      className={`rounded-xl border p-3.5 flex flex-col gap-2.5 transition-colors ${
        dead
          ? 'bg-rose-500/[0.05] border-rose-500/25'
          : 'bg-slate-800/60 border-slate-700/60 hover:border-slate-600'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-slate-100 truncate">{stats.label}</span>
          <span
            className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border shrink-0 ${
              CATEGORY_BADGE[stats.category]
            }`}
          >
            {stats.category === 'consumer' ? 'cons' : 'biz'}
          </span>
        </div>
        <div className="text-[10px] font-mono text-slate-600 truncate" title={target?.note}>
          {target?.host}
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1 min-w-0">
          <span className={`text-2xl font-extrabold font-mono ${tone(stats.lastRoundTripMs)}`}>
            <MetricValue
              value={stats.lastRoundTripMs}
              className={tone(stats.lastRoundTripMs)}
              failure={lastFailure}
            />
          </span>
          {stats.lastRoundTripMs !== null && (
            <span className="text-[11px] font-mono text-slate-500">ms</span>
          )}
        </div>
        <div className="text-right shrink-0">
          {/* A plain string: `{count && …}` puts a bare zero on the page, which
              has shipped in this app before. */}
          <div
            className={`text-[11px] font-mono ${unanswered > 0 ? 'text-amber-300' : 'text-slate-400'}`}
          >
            {`${stats.summary.answered} / ${stats.summary.attempted}`}
          </div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-slate-600">
            answered
          </div>
        </div>
      </div>

      {/* No measurement, no line. A flat trace at the bottom would read as
          "instant", which is the opposite of what an empty card means. */}
      <div className="h-16 -mx-1">
        {plotted >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={stroke} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="round" hide />
              {/* Zero-based and shared with every other card. An auto domain
                  would magnify a 3 ms wobble into a mountain range. */}
              <YAxis domain={[0, yMax ?? 'dataMax']} hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#334155',
                  borderRadius: '0.75rem',
                  fontSize: '11px',
                }}
                formatter={(v) => [typeof v === 'number' ? `${v} ms` : '—', stats.label]}
                labelFormatter={(l) => `Round ${l}`}
              />
              {/* connectNulls stays off: a round with no answer leaves a gap,
                  and drawing through it would invent a measurement. */}
              <Area
                type="monotone"
                dataKey="ms"
                stroke={stroke}
                strokeWidth={1.75}
                fillOpacity={1}
                fill={`url(#${gradientId})`}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[10px] font-mono text-slate-600 text-center px-2 leading-relaxed">
            {!hasStarted
              ? 'no probes yet'
              : dead
                ? 'no answer from this destination'
                : 'not enough measured rounds to draw'}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1 pt-2 border-t border-slate-700/50 text-center">
        {[
          { label: 'median', value: stats.summary.medianMs },
          { label: 'jitter', value: stats.jitterMs },
          { label: 'max', value: stats.summary.maxMs },
        ].map((cell) => (
          <div key={cell.label}>
            <div className="text-[11px] font-mono text-slate-300">
              <MetricValue value={cell.value} unit="ms" failure={summaryFailure} />
            </div>
            <div className="text-[9px] font-mono uppercase tracking-wider text-slate-600">
              {cell.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const WalkTest: React.FC<WalkTestProps> = ({ onHistoryUpdate }) => {
  const [isWalking, setIsWalking] = useState(false);
  const [samples, setSamples] = useState<WalkSample[]>([]);
  const [waypoints, setWaypoints] = useState<WalkWaypoint[]>([]);
  const [spotName, setSpotName] = useState('');
  const [intervalMs, setIntervalMs] = useState<number>(DEFAULT_INTERVAL_MS);
  const [sortKey, setSortKey] = useState<SortKey>('median');
  const [result, setResult] = useState<WalkTestResult | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  // Mirrors of the state the loop and the stop handler read. React state is not
  // visible to a closure created before the render that set it, and the finished
  // record must be built from every sample, not from the ones that existed when
  // the walk started.
  const samplesRef = useRef<WalkSample[]>([]);
  const waypointsRef = useRef<WalkWaypoint[]>([]);
  const currentWaypointIdRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<number>(0);

  const targets = WALK_TARGETS;

  const openSpot = (label: string) => {
    const next = createWaypoint(label, waypointsRef.current.length + 1);
    const closed = waypointsRef.current.map((w, i) =>
      i === waypointsRef.current.length - 1 && w.endedAt === null
        ? { ...w, endedAt: next.startedAt }
        : w,
    );
    waypointsRef.current = [...closed, next];
    currentWaypointIdRef.current = next.id;
    setWaypoints(waypointsRef.current);
    setSpotName('');
  };

  const start = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    samplesRef.current = [];
    waypointsRef.current = [];
    startedAtRef.current = performance.now();

    setSamples([]);
    setResult(null);
    setStorageWarning(null);
    setRound(0);
    setIsWalking(true);
    openSpot(spotName);

    try {
      await runWalkLoop({
        targets,
        intervalMs,
        signal: controller.signal,
        currentWaypointId: () => currentWaypointIdRef.current,
        onRound: (roundSamples, roundNumber) => {
          samplesRef.current = [...samplesRef.current, ...roundSamples];
          setSamples(samplesRef.current);
          setRound(roundNumber);
        },
      });
    } finally {
      setIsWalking(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();

    const finishedAt = Date.now();
    const closedWaypoints = waypointsRef.current.map((w) =>
      w.endedAt === null ? { ...w, endedAt: finishedAt } : w,
    );
    waypointsRef.current = closedWaypoints;
    setWaypoints(closedWaypoints);

    const finished = buildWalkResult({
      targets,
      waypoints: closedWaypoints,
      samples: samplesRef.current,
      intervalMs,
      durationMs: Math.round(performance.now() - startedAtRef.current),
    });
    setResult(finished);

    if (finished.rounds === 0) return;

    const answered = finished.perTarget.reduce((sum, t) => sum + t.summary.answered, 0);
    const attempted = finished.perTarget.reduce((sum, t) => sum + t.summary.attempted, 0);
    const item: HistoryItem = {
      id: finished.id,
      type: 'walktest',
      timestamp: finished.timestamp,
      title:
        `Walk & test: ${closedWaypoints.length} spot${closedWaypoints.length === 1 ? '' : 's'}, ` +
        `${finished.rounds} round${finished.rounds === 1 ? '' : 's'} across ${targets.length} destinations`,
      summary:
        `${answered} of ${attempted} probes answered over ${formatDuration(finished.durationMs)}. ` +
        (finished.conclusions.length > 0
          ? finished.conclusions[0]
          : 'Not enough rounds ran to conclude anything.'),
      data: finished,
    };

    try {
      saveHistoryItem(item);
      onHistoryUpdate();
    } catch (error) {
      setStorageWarning(
        error instanceof StorageFullError
          ? 'The walk is shown below but could not be saved to history — browser storage is full.'
          : 'The walk is shown below but could not be saved to history.',
      );
    }
  };

  const perTarget = useMemo(
    () => targets.map((t) => summariseTarget(t, samples)),
    [targets, samples],
  );

  const perWaypoint = useMemo(
    () => waypoints.map((w) => summariseWaypoint(w, targets, samples)),
    [waypoints, targets, samples],
  );

  const conclusions = useMemo(
    () => buildWalkConclusions(perTarget, perWaypoint),
    [perTarget, perWaypoint],
  );

  const sorted = useMemo(() => {
    const rows = [...perTarget];
    if (sortKey === 'label') return rows.sort((a, b) => a.label.localeCompare(b.label));
    if (sortKey === 'answered') {
      return rows.sort(
        (a, b) =>
          b.summary.answered - b.summary.attempted - (a.summary.answered - a.summary.attempted) ||
          a.label.localeCompare(b.label),
      );
    }

    // Absent values sort last in every direction. A destination that produced
    // nothing must never surface at the top of a list headed "fastest".
    const value = (row: WalkTargetStats): number | null =>
      sortKey === 'median' ? row.summary.medianMs : row.lastRoundTripMs;
    return rows.sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av === null && bv === null) return a.label.localeCompare(b.label);
      if (av === null) return 1;
      if (bv === null) return -1;
      return av - bv || a.label.localeCompare(b.label);
    });
  }, [perTarget, sortKey]);

  /**
   * Everything the charts draw, computed in one pass over the visible window.
   *
   * Only steady-state samples become points: the warm-up rounds and each
   * destination's first answer carry DNS, TCP and TLS, and leaving them in
   * pinned the y-axis near a second for the rest of the session, which flattened
   * every real measurement into a line along the bottom.
   */
  const charts = useMemo(() => {
    const rounds = [...new Set(samples.map((s) => s.round))].sort((a, b) => a - b);
    const visible = rounds.slice(Math.max(0, rounds.length - CHART_WINDOW_ROUNDS));
    const visibleSet = new Set(visible);

    const byTarget = new Map<string, Map<number, number | null>>();
    const answeringByRound = new Map<number, number>();
    const timingsByRound = new Map<number, number[]>();
    let peak = 0;

    for (const s of samples) {
      if (!visibleSet.has(s.round)) continue;

      let lane = byTarget.get(s.targetId);
      if (lane === undefined) {
        lane = new Map();
        byTarget.set(s.targetId, lane);
      }

      if (isSteadyState(s)) {
        const ms = s.roundTripMs as number;
        lane.set(s.round, ms);
        if (ms > peak) peak = ms;
        const bucket = timingsByRound.get(s.round);
        if (bucket === undefined) timingsByRound.set(s.round, [ms]);
        else bucket.push(ms);
      } else {
        lane.set(s.round, null);
      }

      if (s.outcome === 'answered') {
        answeringByRound.set(s.round, (answeringByRound.get(s.round) ?? 0) + 1);
      }
    }

    const seriesFor = (targetId: string): CardPoint[] => {
      const lane = byTarget.get(targetId);
      return visible.map((r) => ({ round: r, ms: lane?.get(r) ?? null }));
    };

    const timeline = visible.map((r) => {
      const mid = median(timingsByRound.get(r) ?? []);
      return {
        round: r,
        answering: answeringByRound.get(r) ?? 0,
        medianMs: mid === null ? null : Math.round(mid),
      };
    });

    // Shared ceiling, rounded up to something legible. Null when nothing has
    // been measured: a default of "10 ms" would be a number on the page that no
    // probe produced, which is exactly what this project does not do. Offline,
    // that caption printed "0 to 10 ms" and it read like a measurement.
    const step = peak > 500 ? 100 : peak > 100 ? 50 : 10;
    const yMax = peak > 0 ? Math.ceil(peak / step) * step : null;

    return { seriesFor, timeline, yMax, windowRounds: visible.length, totalRounds: rounds.length };
  }, [samples]);

  /** The round each spot began at, for the aggregate chart's dividers. Only
   *  spots inside the visible window can be drawn. */
  const spotBoundaries = useMemo(() => {
    const firstVisible = charts.timeline.length > 0 ? charts.timeline[0].round : 0;
    return waypoints
      .map((w) => {
        const first = samples.find((s) => s.waypointId === w.id);
        return first === undefined || first.round < firstVisible
          ? null
          : { round: first.round, label: w.label };
      })
      .filter((b): b is { round: number; label: string } => b !== null);
  }, [waypoints, samples, charts.timeline]);

  const currentSpot = waypoints.length > 0 ? waypoints[waypoints.length - 1] : null;
  const totalAttempted = perTarget.reduce((sum, t) => sum + t.summary.attempted, 0);
  const totalAnswered = perTarget.reduce((sum, t) => sum + t.summary.answered, 0);
  const hasData = totalAttempted > 0;
  const inWarmUp = hasData && round <= WARMUP_ROUNDS;

  const SortButton: React.FC<{ id: SortKey; children: React.ReactNode }> = ({ id, children }) => (
    <button
      onClick={() => setSortKey(id)}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-mono transition-colors ${
        sortKey === id
          ? 'border-teal-500/40 bg-teal-500/10 text-teal-200'
          : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
      }`}
    >
      {children}
      <ArrowUpDown className="w-3 h-3 opacity-60" />
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-400 shrink-0">
            <Footprints className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 min-w-0">
            <h1 className="text-xl font-bold text-slate-100">Walk &amp; Test</h1>
            <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
              Ten destinations people actually depend on — four consumer, six business — probed over
              and over while you walk the building. Name the spot you are standing in, wait a few
              rounds, move, name the next one. The cards below settle as samples arrive; the
              per-spot comparison at the bottom is what you came for.
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-3xl">
              The repeated-probe idea is{' '}
              <a
                href="https://richorama.github.io/AzureSpeedTest2/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
              >
                Richard Astbury&rsquo;s Azure Speed Test
              </a>
              , which times a fixed list of regions until the numbers stop moving. This one expects
              you to move instead.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isWalking ? (
            <button
              onClick={stop}
              className="flex items-center space-x-2 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-400 hover:to-rose-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-rose-500/20 active:scale-95"
            >
              <Square className="w-4 h-4" />
              <span>Finish walk</span>
            </button>
          ) : (
            <button
              onClick={start}
              className="flex items-center space-x-2 bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-teal-500/20 active:scale-95"
            >
              <Play className="w-4 h-4" />
              <span>{result === null ? 'Start walking' : 'Start a new walk'}</span>
            </button>
          )}

          <label className="flex items-center gap-2 text-xs text-slate-400">
            <span>Round every</span>
            <select
              value={intervalMs}
              disabled={isWalking}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 disabled:opacity-50"
              title="The pause between rounds. A round waits for every destination to answer or time out first, so a slow round stretches the gap rather than piling requests up."
            >
              {INTERVAL_CHOICES.map((ms) => (
                <option key={ms} value={ms}>
                  {ms / 1000}s
                </option>
              ))}
            </select>
          </label>

          {isWalking && (
            <span className="flex items-center gap-2 text-[11px] font-mono text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
              round {round} · {totalAnswered} of {totalAttempted} probes answered
            </span>
          )}
        </div>

        {/* The one control that has to be reachable one-handed, mid-walk. */}
        {isWalking && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-800 pt-4">
            <input
              value={spotName}
              onChange={(e) => setSpotName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openSpot(spotName);
              }}
              placeholder="Where are you now? e.g. back bedroom"
              className="flex-1 min-w-[14rem] bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-teal-500/60"
            />
            <button
              onClick={() => openSpot(spotName)}
              className="flex items-center space-x-2 border border-teal-500/40 bg-teal-500/10 hover:bg-teal-500/20 text-teal-200 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors active:scale-95"
            >
              <MapPin className="w-4 h-4" />
              <span>I&rsquo;ve moved — new spot</span>
            </button>
            {currentSpot !== null && (
              <span className="text-[11px] font-mono text-slate-500">
                measuring “{currentSpot.label}”
                {currentSpot.reportedEffectiveType !== null && (
                  <span title="Reported by the browser's Network Information API, not measured by NetReady.">
                    {' '}
                    · browser says {currentSpot.reportedEffectiveType}
                  </span>
                )}
              </span>
            )}
          </div>
        )}

        {!navigator.onLine && (
          <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/25 rounded-xl p-3 text-xs text-rose-100">
            <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              The browser reports no network connection. A walk started now will record every
              destination as unanswered, which is a real result — but nothing here will have a
              round-trip time.
            </span>
          </div>
        )}
      </div>

      {storageWarning !== null && (
        <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-4 text-xs text-amber-100">
          {storageWarning}
        </div>
      )}

      {/* Destination cards. One per probed service, 1 to 5 across depending on
          the width available. */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-100">Destinations</h2>
            <p className="text-[11px] text-slate-500">
              {!hasData
                ? 'Nothing probed yet.'
                : charts.yMax === null
                  ? 'No round trip has been measured yet, so there is nothing to plot and no scale to state.'
                  : `Every sparkline shares one scale, 0 to ${charts.yMax} ms, so the shapes are
                     comparable. ${
                       charts.totalRounds > charts.windowRounds
                         ? `Showing the last ${charts.windowRounds} of ${charts.totalRounds} rounds.`
                         : ''
                     }`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-600 mr-1">
              sort
            </span>
            <SortButton id="median">median</SortButton>
            <SortButton id="last">last</SortButton>
            <SortButton id="answered">answered</SortButton>
            <SortButton id="label">name</SortButton>
          </div>
        </div>

        {inWarmUp && (
          <div className="flex items-start gap-2 bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 text-[11px] text-slate-400">
            <Loader2 className="w-3.5 h-3.5 shrink-0 mt-0.5 animate-spin text-teal-400" />
            <span>
              Warm-up. The first {WARMUP_ROUNDS} rounds pay for DNS, TCP and TLS, so their timings
              are discarded rather than charted — they would set the top of every scale for the rest
              of the walk. Counts still include them.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
          {sorted.map((stats) => (
            <DestinationCard
              key={stats.targetId}
              target={targets.find((t) => t.id === stats.targetId)}
              stats={stats}
              series={charts.seriesFor(stats.targetId)}
              yMax={charts.yMax}
              hasStarted={hasData}
            />
          ))}
        </div>

        <p className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-800 pt-3">
          Median, jitter and max ignore the opening {WARMUP_ROUNDS} rounds and each
          destination&rsquo;s first answer, all of which carry connection setup. They stay blank
          until {MIN_SAMPLES_FOR_SUMMARY} later answers exist, which is about{' '}
          {Math.round(((WARMUP_ROUNDS + MIN_SAMPLES_FOR_SUMMARY + 1) * intervalMs) / 1000)} seconds
          of standing still at this interval. A probe is given {PROBE_TIMEOUT_MS / 1000} seconds
          before it counts as unanswered.
        </p>
      </div>

      {/* Permanent, not collapsible. Without it the cards read as a ping
          comparison between ten companies, which they are not.

          It sits below the cards rather than above them because on a phone —
          which is where a walk test is actually run — seven hundred pixels of
          caveats before the live numbers means scrolling past them at every
          spot. The cards' own footer carries the exclusions that change how a
          figure is read; this panel carries the ones that change what the whole
          tool means, and nothing here is behind a disclosure triangle. */}
      <div className="bg-slate-900 border border-amber-500/20 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-amber-300 font-bold text-xs uppercase tracking-wider">
          <Info className="w-4 h-4 shrink-0" />
          <span>What these numbers are</span>
        </div>
        <ul className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
          <li>
            <span className="font-semibold text-slate-100">
              Each figure is a full HTTPS request round trip, not a ping.
            </span>{' '}
            A web page has no raw sockets, so there is no ICMP and no lower-level timing to read.
            These numbers include TLS on a new connection and the destination&rsquo;s own front-end,
            and they are not comparable to what <span className="font-mono">ping</span> prints.
          </li>
          <li>
            <span className="font-semibold text-slate-100">
              A completed probe proves the edge answered — nothing more.
            </span>{' '}
            The requests are <span className="font-mono">no-cors</span>, so the response is opaque
            by construction and its status code is unreadable. A 200, a 404 and a 401 are
            indistinguishable from here, which is fine: reachability and timing are the whole claim.
            Each URL was picked because it answers outright rather than redirecting — a
            <span className="font-mono"> no-cors</span> request must follow redirects, and a bounce
            would fold two round trips into one number.
          </li>
          <li>
            <span className="font-semibold text-slate-100">
              These are front doors, not the backends.
            </span>{' '}
            You are measuring the CDN edge that terminates TLS near you. Netflix playback, Teams
            call audio and Zoom media all run over paths a browser cannot address at all, so a green
            card here does not promise a smooth call.
          </li>
          <li>
            <span className="font-semibold text-slate-100">
              Unanswered is not the same as down, and it is not packet loss.
            </span>{' '}
            A timeout, a refused connection, a failed name lookup and being out of range all look
            identical to a browser. A blocklist counts too: an ad blocker or a filtering resolver
            can make a perfectly healthy network look like a dead spot for one destination. The
            counter is called <em>answered</em> for that reason.
          </li>
          <li>
            <span className="font-semibold text-slate-100">
              All ten fire at once, every round.
            </span>{' '}
            That gives every destination the same instant, which is the point when the phone is
            moving — but on a constrained link they also compete with each other, which lifts all
            ten together. Compare cards to each other and spots to each other; do not read a single
            figure as this connection&rsquo;s latency.
          </li>
        </ul>
      </div>

      {charts.timeline.length > 1 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              Round by round
            </div>
            <div className="text-[10px] font-mono text-slate-600">
              {charts.totalRounds > charts.windowRounds
                ? `last ${charts.windowRounds} rounds`
                : `${charts.windowRounds} rounds`}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={charts.timeline} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="round"
                tick={{ fill: '#64748b', fontSize: 11 }}
                stroke="#334155"
                label={{
                  value: 'round',
                  fill: '#475569',
                  fontSize: 10,
                  position: 'insideBottomRight',
                  offset: -4,
                }}
              />
              {/* Both axes start at zero: a truncated axis turns a 10 ms
                  difference into a cliff. */}
              <YAxis
                yAxisId="ms"
                domain={[0, 'dataMax']}
                unit="ms"
                tick={{ fill: '#64748b', fontSize: 11 }}
                stroke="#334155"
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                domain={[0, targets.length]}
                allowDecimals={false}
                tick={{ fill: '#64748b', fontSize: 11 }}
                stroke="#334155"
              />
              <Tooltip
                contentStyle={{
                  background: '#0f172a',
                  border: '1px solid #1e293b',
                  borderRadius: 12,
                  fontSize: 12,
                }}
                formatter={(value, name) =>
                  typeof value === 'number' ? [`${value}`, name] : ['—', name]
                }
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                yAxisId="count"
                dataKey="answering"
                name={`Destinations answering (of ${targets.length})`}
                fill="#14b8a6"
                opacity={0.35}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
              <Line
                yAxisId="ms"
                type="monotone"
                dataKey="medianMs"
                name="Median round trip"
                stroke="#22d3ee"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              {spotBoundaries.map((b) => (
                <ReferenceLine
                  key={`${b.round}-${b.label}`}
                  yAxisId="ms"
                  x={b.round}
                  stroke="#64748b"
                  strokeDasharray="4 4"
                  label={{ value: b.label, fill: '#94a3b8', fontSize: 10, position: 'top' }}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            The bars are a straight count and mean what they say. The line is the median across
            whichever destinations answered <em>that round</em>, so when destinations drop out it
            moves partly because the set changed and not only because the network did — watch the
            bars alongside it. The per-spot table below does not have that problem: it compares only
            the destinations that produced a median at every spot.
          </p>
        </div>
      )}

      {perWaypoint.length > 0 && hasData && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-sm font-bold text-slate-100">Spot by spot</h2>
            <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
              Each cell is that destination&rsquo;s median at that spot, over the whole walk rather
              than the charted window. The overall column is the median of those medians, so one
              chatty destination cannot dominate it and it does not lurch when a destination stops
              answering.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-[10px] font-mono uppercase tracking-wider text-slate-500 border-y border-slate-800">
                <tr>
                  <th className="px-3 py-2 text-left">Spot</th>
                  <th className="px-3 py-2 text-right">Rounds</th>
                  <th className="px-3 py-2 text-right">Answered</th>
                  <th className="px-3 py-2 text-right">Overall</th>
                  {targets.map((t) => (
                    <th key={t.id} className="px-3 py-2 text-right whitespace-nowrap">
                      {t.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {perWaypoint.map((w) => {
                  const unanswered = w.attempted - w.answered;
                  const spot = waypoints.find((p) => p.id === w.waypointId);
                  return (
                    <tr key={w.waypointId}>
                      <td className="px-3 py-2.5">
                        <div className="text-xs font-semibold text-slate-200">{w.label}</div>
                        {spot?.reportedEffectiveType !== null && (
                          <div
                            className="text-[10px] font-mono text-slate-600"
                            title="Reported by the browser's Network Information API when this spot was created, not measured."
                          >
                            browser reported {spot?.reportedEffectiveType}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-400">
                        {`${w.rounds}`}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">
                        <span className={unanswered > 0 ? 'text-amber-300' : 'text-slate-400'}>
                          {`${w.answered} / ${w.attempted}`}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">
                        <MetricValue
                          value={w.medianOfTargetMediansMs}
                          unit="ms"
                          className={`font-semibold ${tone(w.medianOfTargetMediansMs)}`}
                          failure={{
                            metric: w.label,
                            reason: 'insufficient-samples',
                            detail:
                              'No destination produced a median at this spot, so there is nothing ' +
                              'to take a median of.',
                          }}
                        />
                      </td>
                      {targets.map((t) => {
                        const cell = w.perTarget.find((p) => p.targetId === t.id);
                        return (
                          <td
                            key={t.id}
                            className="px-3 py-2.5 text-right font-mono text-xs"
                            title={
                              cell === undefined
                                ? undefined
                                : `${cell.summary.answered} of ${cell.summary.attempted} probes answered here`
                            }
                          >
                            <MetricValue
                              value={cell?.summary.medianMs ?? null}
                              unit="ms"
                              className={tone(cell?.summary.medianMs ?? null)}
                              failure={{
                                metric: `${w.label} / ${t.label}`,
                                reason:
                                  cell !== undefined && cell.summary.answered === 0
                                    ? 'api-unreachable'
                                    : 'insufficient-samples',
                                detail:
                                  cell !== undefined && cell.summary.answered === 0
                                    ? `${t.label} answered none of its ${cell.summary.attempted} probes at “${w.label}”.`
                                    : `Not enough answers from ${t.label} at “${w.label}” to report a median.`,
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {conclusions.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            {isWalking ? 'Conclusions so far' : 'Conclusions'}
          </div>
          <ul className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
            {conclusions.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-teal-500 shrink-0">›</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result !== null && (
        <>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-xs text-slate-400 leading-relaxed space-y-1">
            <div>
              Walk finished: {formatDuration(result.durationMs)} across {result.waypoints.length}{' '}
              spot{result.waypoints.length === 1 ? '' : 's'}, {result.rounds} round
              {result.rounds === 1 ? '' : 's'}, {displayMetric(result.rounds * targets.length)}{' '}
              probes.
            </div>
            {result.samplesDropped > 0 && (
              <div className="text-amber-300/80">
                {result.samplesDropped} individual probe record
                {result.samplesDropped === 1 ? '' : 's'} were dropped from the saved copy — only the
                most recent {MAX_STORED_SAMPLES} are kept, to stay inside the browser&rsquo;s
                storage budget. Every statistic above was calculated before that truncation.
              </div>
            )}
          </div>
          <FailureNotice failures={result.failures.length > 0 ? result.failures : undefined} />
        </>
      )}
    </div>
  );
};
