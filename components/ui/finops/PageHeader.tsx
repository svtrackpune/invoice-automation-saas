import Link from 'next/link';
import type { ReactNode } from 'react';
import { finOpsToneClasses, type FinOpsSemanticTone } from './semantic';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: { label: string; variant: FinOpsSemanticTone };
  actions?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}

export default function PageHeader({ title, subtitle, badge, actions, breadcrumbs }: PageHeaderProps) {
  const badgeTone = badge ? finOpsToneClasses[badge.variant] : null;

  return (
    <header className="finops-page-header gap-4" data-finops-page-header>
      <div className="min-w-0">
        {breadcrumbs?.length ? (
          <nav aria-label="Breadcrumb" className="mb-1">
            <ol className="flex flex-wrap items-center gap-2 text-xs text-finops-neutral-muted">
              {breadcrumbs.map((crumb, index) => {
                const current = index === breadcrumbs.length - 1;
                return (
                  <li key={`${crumb.label}-${index}`} className="inline-flex items-center gap-2">
                    {index > 0 ? <span aria-hidden="true" className="text-slate-300">/</span> : null}
                    {crumb.href && !current ? (
                      <Link href={crumb.href} className="transition-colors hover:text-finops-neutral-text hover:underline">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span aria-current={current ? 'page' : undefined} className={current ? 'font-semibold text-finops-neutral-text' : undefined}>
                        {crumb.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-finops-neutral-text">{title}</h1>
          {badge && badgeTone ? (
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${badgeTone.border} ${badgeTone.tint} ${badgeTone.primary}`}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${badgeTone.rail}`} />
              {badge.label}
            </span>
          ) : null}
        </div>
        {subtitle ? <p className="mt-1 max-w-3xl text-sm leading-6 text-finops-neutral-muted">{subtitle}</p> : null}
      </div>

      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
