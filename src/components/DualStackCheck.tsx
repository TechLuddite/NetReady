import React, { useState } from 'react';
import { Network, Play, Loader2, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import type { AddressFamily, DualStackResult, HistoryItem } from '../types';
import { checkDualStack, describeReachability } from '../utils/dualStack';
import { FailureNotice, MetricValue } from './MetricValue';
import { saveHistoryItem } from '../utils/storage';

/**
 * Dual-stack (IPv4 / IPv6) reachability.
 *
 * The interesting part of this check is what it refuses to say. "No IPv6 probe
 * answered" is displayed as exactly that, never as "IPv6 is disabled" — a
 * browser cannot distinguish an absent IPv6 path from two probe hosts being
 * unreachable, and dressing one up as the other would be a diagnosis the
 * evidence does not support.
 */

interface DualStackCheckProps {
  onHistoryUpdate: () => void;
}

const FAMILY_LABEL: Record<AddressFamily, string> = { ipv4: 'IPv4', ipv6: 'IPv6' };

const VERDICT_TONE: Record<NonNullable<DualStackResult['verdict']>, string> = {
  'dual-stack': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  'ipv4-only': 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  'ipv6-only': 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  'neither-family-answered': 'border-rose-500/40 bg-rose-500/10 text-rose-200',
};

const VERDICT_HEADLINE: Record<NonNullable<DualStackResult['verdict']>, string> = {
  'dual-stack': 'Both address families work',
  'ipv4-only': 'IPv4 only',
  'ipv6-only': 'IPv6 only',
  'neither-family-answered': 'Neither family answered',
};

const FamilyCard: React.FC<{
  family: AddressFamily;
  reachable: boolean | null;
  result: DualStackResult;
}> = ({ family, reachable, result }) => {
  const probes = result.probes.filter((p) => p.family === family);
  const Icon = reachable === null ? MinusCircle : reachable ? CheckCircle2 : XCircle;
  const tone =
    reachable === null ? 'text-slate-500' : reachable ? 'text-emerald-400' : 'text-rose-400';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-100">{FAMILY_LABEL[family]}</h3>
        <span className={`flex items-center gap-1.5 text-xs font-mono ${tone}`}>
          <Icon className="w-4 h-4" />
          {describeReachability(reachable)}
        </span>
      </div>

      {probes.length === 0 ? (
        <p className="text-[11px] text-slate-500">No {FAMILY_LABEL[family]} endpoint was tried.</p>
      ) : (
        <ul className="space-y-2">
          {probes.map((p) => (
            <li key={p.host} className="text-[11px] space-y-0.5 border-b border-white/5 pb-2 last:border-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-slate-300 truncate">{p.host}</span>
                <span className="font-mono text-slate-400 shrink-0">
                  <MetricValue value={p.roundTripMs} unit="ms" className="text-slate-300" />
                </span>
              </div>
              {p.observedIp !== null && (
                <div className="font-mono text-slate-500">saw {p.observedIp}</div>
              )}
              {p.error !== null && <div className="text-slate-500 leading-relaxed">{p.error}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const DualStackCheck: React.FC<DualStackCheckProps> = ({ onHistoryUpdate }) => {
  const [result, setResult] = useState<DualStackResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [stage, setStage] = useState<string>('');

  const run = async () => {
    setIsRunning(true);
    setResult(null);
    try {
      const r = await checkDualStack(setStage);
      setResult(r);

      const item: HistoryItem = {
        id: r.id,
        type: 'dualstack',
        timestamp: r.timestamp,
        title: `Dual-stack: ${r.verdict === null ? 'no verdict' : VERDICT_HEADLINE[r.verdict]}`,
        summary:
          `IPv4 ${describeReachability(r.ipv4Reachable)} | IPv6 ${describeReachability(r.ipv6Reachable)}` +
          (r.preferredFamily === null ? '' : ` | prefers ${FAMILY_LABEL[r.preferredFamily]}`),
        data: r,
      };
      saveHistoryItem(item);
      onHistoryUpdate();
    } finally {
      setIsRunning(false);
      setStage('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 shrink-0">
            <Network className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 min-w-0">
            <h1 className="text-xl font-bold text-slate-100">Dual-stack reachability</h1>
            <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
              A page cannot ask the browser which address families this machine has. What it can do
              is call hostnames that publish only an A record, and hostnames that publish only an
              AAAA record, and see which answer. Two independent providers are tried per family, so
              one provider having a bad day does not become a verdict about your network.
            </p>
          </div>
        </div>

        <button
          onClick={run}
          disabled={isRunning}
          className="flex items-center space-x-2 bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-400 hover:to-blue-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-indigo-500/20 active:scale-95 disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{stage.length > 0 ? stage : 'Checking…'}</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>{result ? 'Check again' : 'Check IPv4 and IPv6'}</span>
            </>
          )}
        </button>
      </div>

      {result && (
        <>
          <div
            className={`border rounded-2xl p-6 space-y-2 ${
              result.verdict === null
                ? 'border-slate-700 bg-slate-800/40 text-slate-300'
                : VERDICT_TONE[result.verdict]
            }`}
          >
            <h2 className="text-lg font-bold">
              {result.verdict === null ? 'No verdict' : VERDICT_HEADLINE[result.verdict]}
            </h2>
            <p className="text-xs leading-relaxed opacity-90 max-w-3xl">{result.explanation}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FamilyCard family="ipv4" reachable={result.ipv4Reachable} result={result} />
            <FamilyCard family="ipv6" reachable={result.ipv6Reachable} result={result} />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-xs text-slate-400 leading-relaxed space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              Which family the browser chose
            </div>
            {result.preferredFamily === null ? (
              <p>
                Not determined. The dual-stack reference host did not report a readable client
                address, so there is nothing to read a preference from.
              </p>
            ) : (
              <p>
                A dual-stack host saw this browser arrive over{' '}
                <span className="font-mono text-cyan-300">
                  {FAMILY_LABEL[result.preferredFamily]}
                </span>
                , via <span className="font-mono">{result.preferredFamilySource}</span>. That is the
                family the browser picks when both are on offer.
              </p>
            )}
          </div>

          <FailureNotice failures={result.failures.length > 0 ? result.failures : undefined} />
        </>
      )}
    </div>
  );
};
