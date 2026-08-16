import React, { useMemo, useRef, useState } from 'react';
import {
  Timer,
  Play,
  Loader2,
  Square,
  Info,
  ArrowUpDown,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  DnsBenchmarkResult,
  DnsMetricSummary,
  DnssecValidation,
  HistoryItem,
  NxdomainHonesty,
  ResolverBenchmark,
} from '../types';
import {
  CORS_BLOCKED_RESOLVERS,
  DOH_RESOLVERS,
  MIN_SAMPLES_PER_METRIC,
  POPULAR_NAMES,
  runDnsBenchmark,
} from '../utils/dnsBenchmark';
import { displayMetric, FailureNotice, MetricValue } from './MetricValue';
import { saveHistoryItem, StorageFullError } from '../utils/storage';

/**
 * DNS resolver benchmark, after Steve Gibson's GRC DNS Benchmark.
 *
 * The design job here is mostly about what the screen must not imply. A
 * resolver that produced no samples gets an em-dash in every cell and no bar on
 * the chart at all — a zero-length bar reads as "instant", which is the
 * opposite of the truth. The panel explaining that your own ISP's resolver
 * cannot be measured from a browser is permanent rather than collapsible,
 * because a user who misses it will read this table as a ranking of their DNS.
 */

interface DnsBenchmarkProps {
  onHistoryUpdate: () => void;
}

type SortKey = 'cached' | 'uncached' | 'dotcom' | 'label';

const NXDOMAIN_LABEL: Record<NxdomainHonesty, string> = {
  honest: 'Honest',
  'answers-with-an-address': 'Returns an address',
  inconclusive: 'Not determined',
};

const NXDOMAIN_TONE: Record<NxdomainHonesty, string> = {
  honest: 'text-emerald-400',
  'answers-with-an-address': 'text-amber-400',
  inconclusive: 'text-slate-500',
};

const DNSSEC_LABEL: Record<DnssecValidation, string> = {
  validates: 'Validates',
  'does-not-validate': 'Passes through',
  inconclusive: 'Not determined',
};

const DNSSEC_ICON: Record<DnssecValidation, React.FC<{ className?: string }>> = {
  validates: ShieldCheck,
  'does-not-validate': ShieldOff,
  inconclusive: ShieldQuestion,
};

const DNSSEC_TONE: Record<DnssecValidation, string> = {
  validates: 'text-emerald-400',
  'does-not-validate': 'text-slate-400',
  inconclusive: 'text-slate-500',
};

const OUTCOME_BADGE: Record<ResolverBenchmark['outcome'], { text: string; tone: string } | null> = {
  measured: null,
  'partially-measured': { text: 'partial', tone: 'bg-amber-500/15 text-amber-300' },
  'no-readable-answer': { text: 'no answer', tone: 'bg-rose-500/15 text-rose-300' },
  'blocked-by-browser': { text: 'cors-blocked', tone: 'bg-slate-700/60 text-slate-400' },
  'not-attempted': { text: 'not attempted', tone: 'bg-slate-700/60 text-slate-400' },
};

const SERIES = [
  { key: 'cached' as const, name: 'Cached', fill: '#f87171' },
  { key: 'uncached' as const, name: 'Uncached', fill: '#4ade80' },
  { key: 'dotcom' as const, name: '.com', fill: '#c084fc' },
];

/** Signed rendering, so a negative reads as a negative rather than disappearing. */
const signedMs = (value: number | null): string => {
  if (value === null) return '—';
  if (value > 0) return `+${value} ms`;
  return `${value} ms`;
};

const failureFor = (row: ResolverBenchmark, metric: DnsMetricSummary) =>
  metric.medianMs === null
    ? {
        metric: row.resolverId,
        reason: 'insufficient-samples' as const,
        detail: row.note,
      }
    : undefined;

const MetricCell: React.FC<{ row: ResolverBenchmark; metric: DnsMetricSummary }> = ({
  row,
  metric,
}) => (
  <td className="px-3 py-2.5 text-right font-mono text-xs">
    <MetricValue
      value={metric.medianMs}
      unit="ms"
      className="text-slate-200"
      failure={failureFor(row, metric)}
    />
  </td>
);

export const DnsBenchmark: React.FC<DnsBenchmarkProps> = ({ onHistoryUpdate }) => {
  const [result, setResult] = useState<DnsBenchmarkResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dnssec, setDnssec] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('cached');
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setResult(null);
    setStorageWarning(null);
    setProgress(null);

    try {
      const r = await runDnsBenchmark({
        dnssec,
        signal: controller.signal,
        onProgress: (nextStage, done, total) => {
          setStage(nextStage);
          setProgress({ done, total });
        },
      });
      setResult(r);

      const measured = r.resolvers.filter((row) => row.outcome === 'measured').length;
      const fastest = r.resolvers.find((row) => row.resolverId === r.fastestCachedResolverId);
      const item: HistoryItem = {
        id: r.id,
        type: 'dnsbench',
        timestamp: r.timestamp,
        title: `DNS benchmark: ${measured} of ${DOH_RESOLVERS.length} resolvers measured`,
        summary:
          fastest === undefined
            ? 'No resolver produced enough answers to rank.'
            : `Lowest cached median: ${fastest.label} at ` +
              `${displayMetric(fastest.cached.medianMs, 'ms')}` +
              (r.fastestIsWithinNoise === true ? ' (within noise of the runner-up)' : ''),
        data: r,
      };
      try {
        saveHistoryItem(item);
        onHistoryUpdate();
      } catch (error) {
        // This result is larger than most, so it is the one most likely to hit
        // the quota. Say so rather than losing the run silently.
        setStorageWarning(
          error instanceof StorageFullError
            ? 'The results are shown below but could not be saved to history — browser storage is full.'
            : 'The results are shown below but could not be saved to history.',
        );
      }
    } finally {
      setIsRunning(false);
      setStage('');
      setProgress(null);
      abortRef.current = null;
    }
  };

  const sorted = useMemo(() => {
    if (result === null) return [];
    const rows = [...result.resolvers];
    if (sortKey === 'label') return rows.sort((a, b) => a.label.localeCompare(b.label));

    // Absent medians sort last in every direction. A resolver that produced
    // nothing must never surface at the top of a list headed "fastest".
    return rows.sort((a, b) => {
      const av = a[sortKey].medianMs;
      const bv = b[sortKey].medianMs;
      if (av === null && bv === null) return a.label.localeCompare(b.label);
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av !== bv) return av - bv;
      // GRC sorts hierarchically: cached first, then uncached, then dotcom.
      const tie = (a.uncached.medianMs ?? Infinity) - (b.uncached.medianMs ?? Infinity);
      if (tie !== 0) return tie;
      return (a.dotcom.medianMs ?? Infinity) - (b.dotcom.medianMs ?? Infinity);
    });
  }, [result, sortKey]);

  const chartRows = useMemo(
    () =>
      sorted
        .filter((row) => row.cached.medianMs !== null)
        .map((row) => ({
          label: row.label,
          cached: row.cached.medianMs,
          uncached: row.uncached.medianMs,
          dotcom: row.dotcom.medianMs,
        })),
    [sorted],
  );

  const unplotted = sorted.length - chartRows.length;

  const SortHeader: React.FC<{ id: SortKey; children: React.ReactNode; align?: string }> = ({
    id,
    children,
    align = 'text-right',
  }) => (
    <th className={`px-3 py-2 ${align}`}>
      <button
        onClick={() => setSortKey(id)}
        className={`inline-flex items-center gap-1 hover:text-slate-200 transition-colors ${
          sortKey === id ? 'text-cyan-300' : ''
        }`}
      >
        {children}
        <ArrowUpDown className="w-3 h-3 opacity-60" />
      </button>
    </th>
  );

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 shrink-0">
            <Timer className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 min-w-0">
            <h1 className="text-xl font-bold text-slate-100">DNS resolver benchmark</h1>
            <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
              Times public DNS-over-HTTPS resolvers three ways, following the split Steve Gibson
              designed for GRC&rsquo;s DNS Benchmark: a name the resolver already holds, a name it
              must fetch from an authoritative server, and a name that forces it out to the{' '}
              <span className="font-mono">.com</span> servers. A resolver can be instant from cache
              and badly connected to everything else, and measuring only one of those tells you
              neither.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={run}
            disabled={isRunning}
            className="flex items-center space-x-2 bg-gradient-to-r from-sky-500 to-cyan-600 hover:from-sky-400 hover:to-cyan-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-sky-500/20 active:scale-95 disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{stage.length > 0 ? stage : 'Running…'}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>{result ? 'Run again' : 'Benchmark resolvers'}</span>
              </>
            )}
          </button>

          {isRunning && (
            <button
              onClick={() => abortRef.current?.abort()}
              className="flex items-center space-x-2 border border-slate-700 hover:border-slate-600 text-slate-300 px-4 py-2.5 rounded-xl text-sm transition-colors active:scale-95"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Stop</span>
            </button>
          )}

          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dnssec}
              disabled={isRunning}
              onChange={(e) => setDnssec(e.target.checked)}
              className="accent-sky-500"
            />
            Check DNSSEC validation
          </label>

          {progress !== null && progress.total > 0 && (
            <span className="text-[11px] font-mono text-slate-500">
              {progress.done} / {progress.total} queries
            </span>
          )}
        </div>
      </div>

      {/* Permanent, not collapsible. A reader who misses this will take the
          table below for a ranking of their own DNS, which it is not. */}
      <div className="bg-slate-900 border border-amber-500/20 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-amber-300 font-bold text-xs uppercase tracking-wider">
          <Info className="w-4 h-4 shrink-0" />
          <span>What this cannot measure</span>
        </div>
        <ul className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
          <li>
            <span className="font-semibold text-slate-100">
              Your own resolver is not in this list, and cannot be.
            </span>{' '}
            A web page has no raw sockets, no way to learn the address your system is using, and no
            way to force a fresh lookup through it with a readable timing. This compares public
            DNS-over-HTTPS providers to each other. To benchmark the resolver you are actually
            using, use Steve Gibson&rsquo;s{' '}
            <a
              href="https://www.grc.com/dns/benchmark.htm"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
            >
              GRC DNS Benchmark
            </a>
            , a native tool that queries nameservers directly over UDP. The three-way split above is
            his design.
          </li>
          <li>
            <span className="font-semibold text-slate-100">
              Every figure includes the HTTPS round trip.
            </span>{' '}
            TLS, HTTP framing and the operator&rsquo;s front-end are inside each number, so these
            are not comparable to the UDP timings a native tool reports.
            {result?.phaseTimingsAvailable === false && (
              <>
                {' '}
                This run confirmed it: none of these endpoints sent{' '}
                <span className="font-mono">Timing-Allow-Origin</span>, so the browser could not
                split DNS from TCP from TLS. That breakdown is absent rather than estimated.
              </>
            )}
          </li>
          <li>
            <span className="font-semibold text-slate-100">
              The list is short because of CORS, not merit.
            </span>{' '}
            {CORS_BLOCKED_RESOLVERS.map((r) => r.label).join(', ')} send no{' '}
            <span className="font-mono">Access-Control-Allow-Origin</span> header, so a browser
            cannot read their answers at all. They are listed in the table with no figures, and
            NetReady never sends them a query.
          </li>
          <li>
            <span className="font-semibold text-slate-100">
              A failed request is not the resolver&rsquo;s fault.
            </span>{' '}
            Over HTTPS a lost query, a TLS failure, a blocking extension and a CORS rejection all
            look identical to a browser. The &ldquo;Answered&rdquo; column counts replies; it is
            deliberately not called reliability.
          </li>
        </ul>
      </div>

      {storageWarning !== null && (
        <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-4 text-xs text-amber-100">
          {storageWarning}
        </div>
      )}

      {result && (
        <>
          <div
            className={`border rounded-2xl p-6 space-y-2 ${
              result.verdict === null
                ? 'border-slate-700 bg-slate-800/40 text-slate-300'
                : result.verdict === 'measured'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
            }`}
          >
            <h2 className="text-lg font-bold">
              {result.verdict === null ? 'Nothing measured' : 'Results'}
            </h2>
            <p className="text-xs leading-relaxed opacity-90 max-w-3xl">{result.explanation}</p>
          </div>

          {chartRows.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Median response time
              </div>
              <ResponsiveContainer width="100%" height={chartRows.length * 46 + 60}>
                <BarChart data={chartRows} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1e293b" />
                  {/* The axis must start at zero. Recharts' default of
                      ['auto','auto'] can begin a numeric axis above zero, which
                      visually multiplies a small difference into a large one.
                      Scaling the top end is fine — GRC does it too. */}
                  <XAxis
                    type="number"
                    domain={[0, 'dataMax']}
                    unit="ms"
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    stroke="#334155"
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={130}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    stroke="#334155"
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid #1e293b',
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(value) => (typeof value === 'number' ? `${value} ms` : '—')}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {SERIES.map((s) => (
                    <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.fill} radius={[0, 3, 3, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              {unplotted > 0 && (
                <p className="text-[11px] text-slate-500">
                  {unplotted} resolver{unplotted === 1 ? '' : 's'} produced no measurements and{' '}
                  {unplotted === 1 ? 'is' : 'are'} not plotted — a zero-length bar would read as
                  &ldquo;instant&rdquo;. See the table below.
                </p>
              )}
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-[10px] font-mono uppercase tracking-wider text-slate-500 border-b border-slate-800">
                  <tr>
                    <SortHeader id="label" align="text-left">
                      Resolver
                    </SortHeader>
                    <SortHeader id="cached">Cached</SortHeader>
                    <SortHeader id="uncached">Uncached</SortHeader>
                    <SortHeader id="dotcom">.com</SortHeader>
                    <th className="px-3 py-2 text-right">Extra vs cached</th>
                    <th className="px-3 py-2 text-right">Answered</th>
                    <th className="px-3 py-2 text-left">Bad names</th>
                    <th className="px-3 py-2 text-left">DNSSEC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sorted.map((row) => {
                    const badge = OUTCOME_BADGE[row.outcome];
                    const muted =
                      row.outcome === 'blocked-by-browser' || row.outcome === 'not-attempted';
                    const answered =
                      row.cached.answered + row.uncached.answered + row.dotcom.answered;
                    const attempted =
                      row.cached.attempted + row.uncached.attempted + row.dotcom.attempted;
                    const DnssecIcon = row.dnssec === null ? ShieldQuestion : DNSSEC_ICON[row.dnssec];

                    return (
                      <tr key={row.resolverId} className={muted ? 'opacity-50' : ''}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-200">{row.label}</span>
                            {badge !== null && (
                              <span
                                className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${badge.tone}`}
                                title={row.note}
                              >
                                {badge.text}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-slate-600 truncate max-w-[18rem]">
                            {row.endpoint}
                          </div>
                        </td>
                        <MetricCell row={row} metric={row.cached} />
                        <MetricCell row={row} metric={row.uncached} />
                        <MetricCell row={row} metric={row.dotcom} />
                        <td
                          className="px-3 py-2.5 text-right font-mono text-xs text-slate-400"
                          title="Uncached median minus cached median, for this resolver only. Not comparable between resolvers."
                        >
                          {signedMs(row.uncachedCostMs)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-400">
                          {/* Rendered as a plain string: `{answered && …}` puts a
                              bare 0 on the page, which has shipped here before. */}
                          {`${answered} / ${attempted}`}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`text-[11px] ${NXDOMAIN_TONE[row.nxdomainHonesty]}`}
                            title={row.nxdomainDetail}
                          >
                            {NXDOMAIN_LABEL[row.nxdomainHonesty]}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1.5 text-[11px] ${
                              row.dnssec === null ? 'text-slate-500' : DNSSEC_TONE[row.dnssec]
                            }`}
                            title={row.dnssecDetail}
                          >
                            <DnssecIcon className="w-3.5 h-3.5" />
                            {row.dnssec === null ? 'Not checked' : DNSSEC_LABEL[row.dnssec]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2.5 border-t border-slate-800 text-[11px] text-slate-500 leading-relaxed">
              Each resolver received {result.samplesPerMetric} queries per column, sent one at a
              time and cycled between resolvers so a burst of other traffic does not land on one of
              them. Before measuring, each resolver got one warm-up query per name (
              {POPULAR_NAMES.join(', ')}) whose timing was discarded — the first request to a host
              pays for DNS, TCP and TLS. A column reads &ldquo;—&rdquo; below{' '}
              {MIN_SAMPLES_PER_METRIC} answers.
            </div>
          </div>

          {result.conclusions.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Conclusions
              </div>
              <ul className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
                {result.conclusions.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span className="text-cyan-500 shrink-0">›</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <FailureNotice failures={result.failures.length > 0 ? result.failures : undefined} />
        </>
      )}
    </div>
  );
};
