'use client';

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export function FormCard({ children, title, description, actions, className = '' }: { children: ReactNode; title?: string; description?: string; actions?: ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>
    {(title || description || actions) && <header className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div>{title && <h2 className="text-base font-semibold text-slate-950">{title}</h2>}{description && <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{description}</p>}</div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>}
    <div className="p-5 sm:p-6">{children}</div>
  </section>;
}

export function FormField({ label, children, required = false, hint, error, className = '' }: { label: string; children: ReactNode; required?: boolean; hint?: string; error?: string; className?: string }) {
  return <label className={`block text-xs font-semibold text-slate-600 ${className}`}>
    <span>{label}{required && <span className="ml-1 text-violet-600" aria-hidden="true">*</span>}</span>
    <div className="mt-1.5">{children}</div>
    {error ? <span className="mt-1.5 block text-[11px] font-medium text-rose-600">{error}</span> : hint ? <span className="mt-1.5 block text-[11px] font-normal text-slate-400">{hint}</span> : null}
  </label>;
}

const control = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';

export function FormInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${control} ${className}`} />;
}

export function FormSelect({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${control} ${className}`}>{children}</select>;
}

export function FormTextarea({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${control} min-h-24 resize-y ${className}`} />;
}

export function FormButton({ children, variant = 'primary', ...props }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'danger' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = variant === 'primary' ? 'bg-violet-600 text-white hover:bg-violet-700' : variant === 'danger' ? 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
  return <button {...props} type={props.type || 'button'} className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${props.className || ''}`}>{children}</button>;
}

export function FormGrid({ children, columns = 'md:grid-cols-2' }: { children: ReactNode; columns?: string }) {
  return <div className={`grid gap-4 ${columns}`}>{children}</div>;
}

export function ConditionalSection({ when, children }: { when: boolean; children: ReactNode }) {
  return when ? <>{children}</> : null;
}

export function FormActions({ children }: { children: ReactNode }) {
  return <footer className="sticky bottom-0 z-20 -mx-5 mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:-mx-6 sm:flex-row sm:justify-end sm:px-6">{children}</footer>;
}
