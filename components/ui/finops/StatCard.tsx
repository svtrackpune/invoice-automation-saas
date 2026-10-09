import type { ReactNode } from 'react';
import { finOpsToneClasses, type FinOpsSemanticTone } from './semantic';

export type StatCardDelta = 'up' | 'down' | 'neutral';

export type StatCardProps = {
  title: string;
  value: string;
  delta: StatCardDelta;
  periodLabel: string;
  badge?: ReactNode;
  sparkline?: ReactNode;
  /** Explicit financial meaning; neutral keeps the historical default appearance. */
  tone?: FinOpsSemanticTone;
};

const deltaCopy: Record<StatCardDelta, string> = {
  up: '↑ Improving',
  down: '↓ Needs attention',
  neutral: '• Stable',
};

export default function StatCard({
  title,
  value,
  delta,
  periodLabel,
  badge,
  sparkline,
  tone = 'neutral',
}: StatCardProps) {
  const palette = finOpsToneClasses[tone];
  const deltaTone = delta === 'up'
    ? finOpsToneClasses.inflow.primary
    : delta === 'down'
      ? finOpsToneClasses.outflow.primary
      : finOpsToneClasses.neutral.muted;

  return (
    <section className={`finops-metric-tile ${palette.border} ${palette.tint}`}>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${palette.rail}`} />
      <div className="flex items-start justify-between gap-3 pl-1">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold uppercase tracking-wider text-finops-neutral-muted">{title}</p>
          <div className="mt-2 flex items-center gap-2">
            <strong className={`font-mono text-2xl font-bold tabular-nums ${palette.primary}`}>{value}</strong>
            {badge}
          </div>
        </div>
        {sparkline ? <div className="shrink-0 pt-1">{sparkline}</div> : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 pl-1 text-[10px]">
        <span className={`font-semibold ${deltaTone}`}>{deltaCopy[delta]}</span>
        <span className="truncate text-finops-neutral-muted">{periodLabel}</span>
      </div>
    </section>
  );
}
