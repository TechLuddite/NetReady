import React from 'react';
import { Target, HelpCircle } from 'lucide-react';
import type { NetReadyScore, PingResult, SpeedTestResult } from '../types';
import { attributeBottleneck, constraintLabel } from '../analysis/bottleneck';
import type { ConstraintInput } from '../analysis/bottleneck';

/**
 * The dashboard headline.
 *
 * A grade answers "how good is this?". The question people actually have is
 * "what do I change?", and four progress bars never answered it — they showed
 * which categories scored low without saying which measured input was dragging
 * them down. This names the binding constraint and, just as usefully, names
 * what is *not* the problem so effort does not go there.
 *
 * When the constraint cannot be identified the component says so plainly. It
 * has no fallback state that guesses.
 */

interface BottleneckSummaryProps {
  score: NetReadyScore | null;
  speed: SpeedTestResult | null;
  ping: PingResult | null;
}

const CONSTRAINT_TONE: Record<ConstraintInput, string> = {
  bufferbloat: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  download: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10',
  upload: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10',
  latency: 'text-indigo-300 border-indigo-500/40 bg-indigo-500/10',
  jitter: 'text-purple-300 border-purple-500/40 bg-purple-500/10',
};

export const BottleneckSummary: React.FC<BottleneckSummaryProps> = ({ score, speed, ping }) => {
  const attribution = attributeBottleneck(speed, ping, score);
  const ranked = attribution.sensitivities.filter((s) => s.gain > 0);
  const maxGain = ranked.length > 0 ? ranked[0].gain : 0;

  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div
          className={`p-2 rounded-xl border shrink-0 ${
            attribution.constraint === null
              ? 'text-slate-400 border-slate-700 bg-slate-800/60'
              : CONSTRAINT_TONE[attribution.constraint]
          }`}
        >
          {attribution.constraint === null ? (
            <HelpCircle className="w-5 h-5" />
          ) : (
            <Target className="w-5 h-5" />
          )}
        </div>

        <div className="min-w-0 space-y-1.5">
          <h3 className="text-base font-bold text-slate-100 leading-snug">
            {attribution.headline}
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">{attribution.detail}</p>
        </div>
      </div>

      {attribution.evidence.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attribution.evidence.map((e) => (
            <span
              key={`${e.metric}-${e.observation}`}
              className="px-2 py-1 rounded-lg text-[11px] font-mono bg-white/[0.04] border border-white/10 text-slate-300"
              title={`Measured value behind this claim (${e.metric})`}
            >
              {e.observation}
            </span>
          ))}
        </div>
      )}

      {ranked.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            Score points recoverable per input
          </div>
          {ranked.map((s) => (
            <div key={s.input} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-[11px] text-slate-400 capitalize">
                {constraintLabel(s.input)}
              </span>
              <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    s.input === attribution.constraint ? 'bg-amber-400' : 'bg-slate-600'
                  }`}
                  style={{ width: `${maxGain > 0 ? Math.round((s.gain / maxGain) * 100) : 0}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-[11px] text-slate-400">
                +{s.gain}
              </span>
            </div>
          ))}
          <p className="text-[10px] text-slate-500 leading-relaxed pt-1">
            Each figure is how far the overall score would move if that one input stopped limiting
            it, with every other measurement left exactly as it was recorded. The comparison values
            used to work that out are internal to the calculation and are never reported as
            measurements.
            {attribution.constraint === 'bufferbloat' &&
              ' Bufferbloat has no bar here because the score has no bufferbloat term — that gap is' +
                ' exactly why it outranks the inputs that do appear.'}
          </p>
        </div>
      )}
    </div>
  );
};
