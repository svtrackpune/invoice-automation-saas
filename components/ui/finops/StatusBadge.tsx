import type { ReactNode } from 'react';

export type FinOpsStatus = 'draft' | 'void' | 'paid' | 'pending' | 'overdue' | 'reconciled' | 'locked';

const styles: Record<FinOpsStatus, string> = {
  draft: 'border border-slate-300 bg-slate-100 text-slate-700',
  void: 'border border-slate-300 bg-slate-100 text-slate-700',
  paid: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
  pending: 'border border-amber-200 bg-amber-50 text-amber-700',
  overdue: 'border border-rose-200 bg-rose-50 text-rose-700',
  reconciled: 'border border-slate-300 bg-slate-100 text-slate-700',
  locked: 'border border-slate-300 bg-slate-100 text-slate-700',
};

export default function StatusBadge({ status }: { status: FinOpsStatus }) {
  const label = status.replaceAll('_', ' ');
  return (
    <span className={'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold capitalize ' + styles[status]}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

export function normalizeFinOpsStatus(status: string): FinOpsStatus {
  const value = status.toLowerCase();
  if (value === 'paid') return 'paid';
  if (value === 'pending' || value === 'sent' || value === 'partially_paid') return 'pending';
  if (value === 'overdue') return 'overdue';
  if (value === 'reconciled') return 'reconciled';
  if (value === 'locked') return 'locked';
  if (value === 'void' || value === 'voided') return 'void';
  return 'draft';
}
