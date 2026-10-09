import { finOpsToneClasses, type FinOpsSemanticTone } from './semantic';

export type FinOpsStatus = 'draft' | 'void' | 'paid' | 'pending' | 'overdue' | 'reconciled' | 'locked';

const statusTones: Record<FinOpsStatus, FinOpsSemanticTone> = {
  draft: 'neutral',
  void: 'outflow',
  paid: 'inflow',
  pending: 'pending',
  overdue: 'outflow',
  reconciled: 'treasury',
  locked: 'statutory',
};

export default function StatusBadge({ status }: { status: FinOpsStatus }) {
  const label = status.replaceAll('_', ' ');
  const tone = finOpsToneClasses[statusTones[status]];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold capitalize ${tone.border} ${tone.tint} ${tone.primary}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.rail} opacity-80`} />
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
