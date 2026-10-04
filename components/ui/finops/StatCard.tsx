import type { ReactNode } from 'react';

export type StatCardDelta = 'up' | 'down' | 'neutral';

export type StatCardProps = {
  title: string;
  value: string;
  delta: StatCardDelta;
  periodLabel: string;
  badge?: ReactNode;
  sparkline?: ReactNode;
};

const deltaCopy: Record<StatCardDelta, string> = {
  up: '↑ Improving',
  down: '↓ Needs attention',
  neutral: '• Stable',
};

export default function StatCard({ title, value, delta, periodLabel, badge, sparkline }: StatCardProps) {
  return (
    <section className="border border-slate-200/90 bg-white p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">{title}</p>
          <div className="mt-2 flex items-center gap-2">
            <strong className="font-mono tabular-nums text-2xl font-bold text-slate-900">{value}</strong>
            {badge}
          </div>
        </div>
        {sparkline ? <div className="shrink-0 pt-1">{sparkline}</div> : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[10px]">
        <span className={delta === 'up' ? 'font-semibold text-emerald-700' : delta === 'down' ? 'font-semibold text-rose-700' : 'font-semibold text-slate-500'}>
          {deltaCopy[delta]}
        </span>
        <span className="truncate text-slate-400">{periodLabel}</span>
      </div>
    </section>
  );
}
