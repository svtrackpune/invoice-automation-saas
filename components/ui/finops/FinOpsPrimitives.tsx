import type { ReactNode } from 'react';

export type FinOpsIconName =
  | 'dashboard' | 'cash' | 'import' | 'invoice' | 'quote' | 'customer' | 'expense' | 'vendor'
  | 'bank' | 'reconcile' | 'statement' | 'tax' | 'report' | 'audit' | 'settings'
  | 'integration' | 'profile' | 'plus' | 'search' | 'bell' | 'chevron' | 'refresh'
  | 'download' | 'arrow';

export function FinOpsIcon({ name, className = 'h-4 w-4' }: { name: FinOpsIconName; className?: string }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<FinOpsIconName, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    import: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></>,
    cash: <><rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M3.5 10h17"/><path d="M8 14h3"/></>,
    invoice: <><path d="M6 3.75h8l4 4v12.5H6z"/><path d="M14 3.75v4h4"/><path d="M9 12h6M9 15.5h4"/></>,
    quote: <><path d="M7 4h10v4H7z"/><path d="M5 8h14v12H5z"/><path d="M9 13h6M9 16h4"/></>,
    customer: <><circle cx="12" cy="8" r="3"/><path d="M5.5 19.5c.7-3.1 2.9-4.7 6.5-4.7s5.8 1.6 6.5 4.7"/></>,
    expense: <><path d="M4 6h16v13H4z"/><path d="M7 6V4h10v2M8 10h8M8 14h5"/></>,
    vendor: <><path d="M3 10h18v9H3z"/><path d="M5 10V7h14v3M8 14h8"/></>,
    bank: <><path d="m3 9 9-5 9 5"/><path d="M5 10v7M9 10v7M15 10v7M19 10v7M3 20h18"/></>,
    reconcile: <><path d="M4 7h10"/><path d="m11 4 3 3-3 3"/><path d="M20 17H10"/><path d="m13 14-3 3 3 3"/></>,
    statement: <><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/></>,
    tax: <><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    report: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></>,
    audit: <><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/></>,
    settings: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/><path d="m5.6 5.6 2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></>,
    integration: <><path d="M8 7h8v10H8z"/><path d="M4 10h4M16 14h4"/></>,
    profile: <><circle cx="12" cy="8" r="3"/><path d="M5.5 20c.7-3.5 2.9-5.3 6.5-5.3s5.8 1.8 6.5 5.3"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    chevron: <><path d="m9 18 6-6-6-6"/></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-4L3 10"/><path d="M3 5v5h5"/><path d="M4 13a8 8 0 0 0 14.7 4L21 14"/><path d="M21 19v-5h-5"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></>,
    arrow: <><path d="M5 12h13"/><path d="m13 6 6 6-6 6"/></>,
  };
  return <svg {...common} className={className} aria-hidden="true">{paths[name]}</svg>;
}

export function FinOpsSectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">{children}</p>;
}

export function FinOpsCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,.03)] ${className}`}>{children}</section>;
}

export function FinOpsPrimaryButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>{children}</button>;
}

export function FinOpsSecondaryButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>{children}</button>;
}

export function FinOpsFilterPill({ active = false, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button {...props} className={`inline-flex h-8 items-center rounded-md px-2.5 text-xs font-semibold transition-colors ${active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{children}</button>;
}

export function FinOpsStatusPill({ label, tone }: { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' | 'indigo' }) {
  const styles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    danger: 'border-rose-200 bg-rose-50 text-rose-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    neutral: 'border-slate-300 bg-slate-100 text-slate-700',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold capitalize ${styles[tone]}`}><span className="h-1.5 w-1.5 rounded-full bg-current opacity-70"/>{label}</span>;
}

export function FinOpsPageHeader({
  breadcrumb,
  title,
  description,
  context,
  status,
  action,
}: {
  breadcrumb: string;
  title: string;
  description?: string;
  context?: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-slate-200/80 pb-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400"><span>{breadcrumb}</span>{context ? <><span>/</span>{context}</> : null}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">{title}</h1>
          {status}
        </div>
        {description ? <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}

export function FinOpsControlBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-[0_1px_2px_rgba(15,23,42,.02)] md:flex-row md:items-center md:justify-between">{children}</div>;
}
