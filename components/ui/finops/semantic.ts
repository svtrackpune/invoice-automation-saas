export type FinOpsSemanticTone = 'inflow' | 'outflow' | 'treasury' | 'statutory' | 'pending' | 'neutral';

export type FinOpsToneClasses = {
  tint: string;
  border: string;
  primary: string;
  muted: string;
  rail: string;
};

/**
 * Single semantic color map for reusable FinOps UI. Keep meaning explicit at call
 * sites; do not infer accounting semantics from a metric's display label.
 */
export const finOpsToneClasses: Record<FinOpsSemanticTone, FinOpsToneClasses> = {
  inflow: {
    tint: 'bg-finops-inflow-tint',
    border: 'border-finops-inflow-border',
    primary: 'text-finops-inflow',
    muted: 'text-finops-inflow-muted',
    rail: 'bg-finops-inflow',
  },
  outflow: {
    tint: 'bg-finops-outflow-tint',
    border: 'border-finops-outflow-border',
    primary: 'text-finops-outflow',
    muted: 'text-finops-outflow-muted',
    rail: 'bg-finops-outflow',
  },
  treasury: {
    tint: 'bg-finops-treasury-tint',
    border: 'border-finops-treasury-border',
    primary: 'text-finops-treasury',
    muted: 'text-finops-treasury-muted',
    rail: 'bg-finops-treasury',
  },
  statutory: {
    tint: 'bg-finops-statutory-tint',
    border: 'border-finops-statutory-border',
    primary: 'text-finops-statutory',
    muted: 'text-finops-statutory-muted',
    rail: 'bg-finops-statutory',
  },
  pending: {
    tint: 'bg-finops-pending-tint',
    border: 'border-finops-pending-border',
    primary: 'text-finops-pending',
    muted: 'text-finops-pending-muted',
    rail: 'bg-finops-pending',
  },
  neutral: {
    tint: 'bg-finops-neutral-background',
    border: 'border-finops-neutral-border',
    primary: 'text-finops-neutral-text',
    muted: 'text-finops-neutral-muted',
    rail: 'bg-finops-neutral-border',
  },
};

export function getFinOpsToneClasses(tone: FinOpsSemanticTone): FinOpsToneClasses {
  return finOpsToneClasses[tone];
}
