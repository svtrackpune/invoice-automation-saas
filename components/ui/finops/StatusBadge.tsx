import type { ReactNode } from 'react';

export type FinOpsStatus = 'draft' | 'void' | 'paid' | 'pending' | 'overdue' | 'reconciled' | 'locked';

const styles: Record<FinOpsStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  void: 'bg-slate-100 text-slate-600',
  paid: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  overdue: 'bg-rose-50 text-rose-700',
  reconciled: 'bg-indigo-50 text-indigo-700',
  locked: 'bg-slate-900 text-white',
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
