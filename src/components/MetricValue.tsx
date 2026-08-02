import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { MeasurementFailure } from '../types';

interface MetricValueProps {
  /** null means "not measured". There is deliberately no `fallback` prop: if a
   *  value is absent, the answer is an em-dash and a reason, never a
   *  substitute number. */
  value: number | null;
  unit?: string;
  precision?: number;
  /** Shown in the tooltip when the value is absent. */
  failure?: MeasurementFailure | undefined;
  className?: string;
  unavailableClassName?: string;
}

export const MetricValue: React.FC<MetricValueProps> = ({
  value,
  unit,
  precision = 0,
  failure,
  className = '',
  unavailableClassName = 'text-slate-600',
}) => {
  if (value === null) {
    return (
      <span
        className={`${unavailableClassName} font-mono`}
        title={failure?.detail ?? 'Not measured.'}
        aria-label={failure?.detail ?? 'Not measured'}
      >
        —
      </span>
    );
  }

  return (
    <span className={className}>
      {value.toFixed(precision)}
      {unit ? <span className="text-slate-400 ml-0.5">{unit}</span> : null}
    </span>
  );
};

/** Formats a possibly-absent metric for plain-text contexts (CSV, summaries,
 *  clipboard). Absent values become an empty string so a reader cannot mistake
 *  them for zero. */
export function formatMetric(value: number | null, unit = '', precision = 0): string {
  if (value === null) return '';
  return `${value.toFixed(precision)}${unit ? ` ${unit}` : ''}`;
}

/** Same, but for on-screen summary strings where a placeholder reads better. */
export function displayMetric(value: number | null, unit = '', precision = 0): string {
  if (value === null) return '—';
  return `${value.toFixed(precision)}${unit ? ` ${unit}` : ''}`;
}

interface FailureNoticeProps {
  failures?: MeasurementFailure[] | undefined;
}

/** Panel-level explanation of everything a run could not determine. */
export const FailureNotice: React.FC<FailureNoticeProps> = ({ failures }) => {
  if (!failures || failures.length === 0) return null;

  return (
    <div
      role="status"
      className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-4 space-y-2"
    >
      <div className="flex items-center space-x-2 text-amber-300 font-bold text-xs uppercase tracking-wider">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span>Not measured ({failures.length})</span>
      </div>
      <ul className="space-y-1 text-xs text-amber-100/90 leading-relaxed">
        {failures.map((f) => (
          <li key={`${f.metric}-${f.reason}`} className="flex gap-2">
            <span className="font-mono text-amber-300/80 shrink-0">{f.metric}</span>
            <span>{f.detail}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-amber-200/60">
        These values are reported as “—” rather than estimated. A missing measurement is
        information; a fabricated one is not.
      </p>
    </div>
  );
};
