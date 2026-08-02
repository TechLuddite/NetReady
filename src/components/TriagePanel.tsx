import React, { useRef, useState } from 'react';
import {
  Stethoscope,
  Play,
  Square,
  CheckCircle2,
  XCircle,
  HelpCircle,
  MinusCircle,
  Loader2,
  Wrench,
  ScanSearch,
} from 'lucide-react';
import type { HistoryItem } from '../types';
import type {
  Attribution,
  Confidence,
  Finding,
  Layer,
  Severity,
  TriageStep,
  TriageVerdict,
} from '../analysis/types';
import { describeLayer } from '../analysis/engine';
import { runTriage, summariseVerdict } from '../analysis/triage';
import type { TriageProgress } from '../analysis/triage';
import { RULES } from '../analysis/rules';
import { FailureNotice } from './MetricValue';
import { saveHistoryItem } from '../utils/storage';
import {
  ResponsibleNetworkingModal,
  isResponsibleNetworkingAccepted,
} from './ResponsibleNetworkingModal';

/**
 * "Is it me or the internet?" — the answer layer's front end.
 *
 * The reasoning behind everything shown here is deterministic, offline and in
 * this repository: a table of rules in `src/analysis/rules.ts`, each with a
 * predicate over named measurements. No model is consulted and no request is
 * made to reach a conclusion. Every finding shows the measurements that
 * produced it, so a user can disagree with the tool on the evidence rather than
 * having to trust it.
 */

interface TriagePanelProps {
  onHistoryUpdate: () => void;
}

const STATUS_STYLE: Record<
  TriageStep['status'],
  { icon: React.FC<{ className?: string }>; tone: string; label: string }
> = {
  pass: { icon: CheckCircle2, tone: 'text-emerald-400', label: 'pass' },
  fail: { icon: XCircle, tone: 'text-rose-400', label: 'fail' },
  inconclusive: { icon: HelpCircle, tone: 'text-amber-400', label: 'inconclusive' },
  skipped: { icon: MinusCircle, tone: 'text-slate-500', label: 'not run' },
  running: { icon: Loader2, tone: 'text-cyan-400 animate-spin', label: 'running' },
  pending: { icon: MinusCircle, tone: 'text-slate-600', label: 'pending' },
};

const ATTRIBUTION_TONE: Record<Attribution, string> = {
  'this-device': 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  'local-network': 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  isp: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
  internet: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200',
  destination: 'border-purple-500/40 bg-purple-500/10 text-purple-200',
  'no-fault-found': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  indeterminate: 'border-slate-600 bg-slate-800/60 text-slate-300',
};

const CONFIDENCE_COPY: Record<Confidence, string> = {
  confirmed: 'The measurement is the finding — nothing is inferred.',
  likely: 'One cause dominates this pattern, but a browser cannot see it directly.',
  possible: 'Consistent with this, and with other explanations too.',
};

const CONFIDENCE_TONE: Record<Confidence, string> = {
  confirmed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  likely: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  possible: 'bg-slate-700/50 text-slate-300 border-slate-600',
};

const SEVERITY_TONE: Record<Severity, string> = {
  blocking: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  degrading: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  informational: 'bg-slate-700/50 text-slate-300 border-slate-600',
};

const LAYER_TONE: Record<Layer, string> = {
  'this-device': 'bg-rose-500/10 text-rose-300 border-rose-500/25',
  'local-network': 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  isp: 'bg-orange-500/10 text-orange-300 border-orange-500/25',
  internet: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/25',
  destination: 'bg-purple-500/10 text-purple-300 border-purple-500/25',
};

const StepRow: React.FC<{ step: TriageStep; isActive: boolean }> = ({ step, isActive }) => {
  const style = STATUS_STYLE[isActive ? 'running' : step.status];
  const Icon = style.icon;
  return (
    <li className="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0">
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${style.tone}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs font-semibold text-slate-200">{step.label}</span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            {style.label}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">{step.question}</p>
        {step.note !== null && (
          <p className="text-[11px] text-slate-400 leading-relaxed mt-1">{step.note}</p>
        )}
      </div>
    </li>
  );
};

const FindingCard: React.FC<{ finding: Finding; rank: number }> = ({ finding, rank }) => {
  const rule = RULES.find((r) => r.id === finding.ruleId);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-6 h-6 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-mono font-bold flex items-center justify-center shrink-0">
          {rank}
        </span>
        <h3 className="text-sm font-bold text-slate-100 flex-1 min-w-[12rem]">{finding.title}</h3>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${SEVERITY_TONE[finding.severity]}`}
        >
          {finding.severity}
        </span>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${CONFIDENCE_TONE[finding.confidence]}`}
          title={CONFIDENCE_COPY[finding.confidence]}
        >
          {finding.confidence}
        </span>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase border ${LAYER_TONE[finding.layer]}`}
        >
          {describeLayer(finding.layer)}
        </span>
      </div>

      <p className="text-xs text-slate-300 leading-relaxed">{finding.verdict}</p>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
          <Wrench className="w-3 h-3" />
          <span>What to do</span>
        </div>
        <ul className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
          {finding.remediation.map((r) => (
            <li key={r} className="flex gap-2">
              <span className="text-cyan-500 shrink-0">-</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>

      {finding.evidence.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-white/5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            Evidence
          </div>
          <ul className="space-y-1 text-[11px] font-mono">
            {finding.evidence.map((e) => (
              <li key={`${e.metric}-${e.observation}`} className="flex flex-wrap gap-x-2">
                <span className="text-cyan-300/80 shrink-0">{e.metric}</span>
                <span className="text-slate-400">{e.observation}</span>
              </li>
            ))}
          </ul>
          {rule && (
            <p className="text-[10px] text-slate-600 font-mono">
              rule {rule.id} · reads {rule.consumes.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export const TriagePanel: React.FC<TriagePanelProps> = ({ onHistoryUpdate }) => {
  const [verdict, setVerdict] = useState<TriageVerdict | null>(null);
  const [progress, setProgress] = useState<TriageProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const execute = async () => {
    setIsRunning(true);
    setError(null);
    setVerdict(null);
    setProgress(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await runTriage({
        onProgress: setProgress,
        signal: controller.signal,
      });
      setVerdict(result);

      const item: HistoryItem = {
        id: result.id,
        type: 'triage',
        timestamp: result.timestamp,
        title: `Triage: ${result.headline}`,
        summary: summariseVerdict(result),
        data: result,
      };
      saveHistoryItem(item);
      onHistoryUpdate();
    } catch (e) {
      setError(
        e instanceof Error ? `The triage run could not finish: ${e.message}` : 'The triage run could not finish.',
      );
    } finally {
      abortRef.current = null;
      setIsRunning(false);
      setProgress(null);
    }
  };

  const handleRun = () => {
    if (!isResponsibleNetworkingAccepted()) {
      setShowConsent(true);
      return;
    }
    execute();
  };

  const passed = verdict?.steps.filter((s) => s.status === 'pass').length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shrink-0">
            <Stethoscope className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 min-w-0">
            <h1 className="text-xl font-bold text-slate-100">Is it me or the internet?</h1>
            <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
              One run walks a decision tree — link, name resolution, interception, address
              families, four unrelated content networks, then the link itself — and applies{' '}
              {RULES.length} rules to what it found. The reasoning is a table of predicates in this
              repository, not a model: it is instant, it works offline, and every finding carries
              the measurements that produced it.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="flex items-center space-x-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-cyan-500/20 active:scale-95 disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{progress?.label ?? 'Running triage…'}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>{verdict ? 'Run triage again' : 'Run triage'}</span>
              </>
            )}
          </button>

          {isRunning && (
            <button
              onClick={() => abortRef.current?.abort()}
              className="flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Stop</span>
            </button>
          )}

          {isRunning && progress?.detail !== null && progress?.detail !== undefined && (
            <span className="text-[11px] font-mono text-slate-400">{progress.detail}</span>
          )}

          <span aria-live="polite" className="sr-only">
            {isRunning ? (progress?.label ?? 'Running triage') : ''}
          </span>
        </div>

        <p className="text-[11px] text-slate-500 leading-relaxed">
          A full run transfers roughly 25&nbsp;MB through the Cloudflare edge for the bandwidth
          step, and contacts the providers listed under Privacy&nbsp;&amp;&nbsp;Safety. If nothing
          out there answers, the bandwidth step is skipped rather than run to produce a guaranteed
          failure.
        </p>
      </div>

      {error !== null && (
        <div role="alert" className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Verdict */}
      {verdict && (
        <div className={`border rounded-2xl p-6 space-y-3 ${ATTRIBUTION_TONE[verdict.attribution]}`}>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider opacity-80">
            <ScanSearch className="w-3.5 h-3.5" />
            <span>Verdict</span>
            <span className="opacity-60">
              · {passed} of {verdict.steps.length} checks passed · {verdict.totalTimeMs} ms
            </span>
          </div>
          <h2 className="text-2xl font-bold leading-tight">{verdict.headline}</h2>
          <p className="text-xs leading-relaxed opacity-90 max-w-3xl">{verdict.summary}</p>
        </div>
      )}

      {/* Findings */}
      {verdict && verdict.findings.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Probable causes, ranked
          </h2>
          {verdict.findings.map((f, i) => (
            <FindingCard key={f.ruleId} finding={f} rank={i + 1} />
          ))}
        </div>
      )}

      {/* Decision tree */}
      {(verdict || isRunning) && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3 shadow-xl">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            What was checked
          </h2>
          <ul>
            {(verdict?.steps ?? []).map((step) => (
              <StepRow
                key={step.id}
                step={step}
                isActive={isRunning && progress?.stepId === step.id}
              />
            ))}
          </ul>
          {isRunning && verdict === null && (
            <p className="text-xs text-slate-400">
              {progress?.label ?? 'Starting…'}
              {progress?.detail !== null && progress?.detail !== undefined
                ? ` — ${progress.detail}`
                : ''}
            </p>
          )}
        </div>
      )}

      {verdict && verdict.failures.length > 0 && <FailureNotice failures={verdict.failures} />}

      <ResponsibleNetworkingModal
        isOpen={showConsent}
        onClose={() => setShowConsent(false)}
        onConfirm={() => {
          setShowConsent(false);
          execute();
        }}
      />
    </div>
  );
};
