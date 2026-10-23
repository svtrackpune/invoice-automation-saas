'use client';

import Link from 'next/link';
import { FinOpsIcon, type FinOpsIconName } from '@/components/ui/finops/FinOpsPrimitives';

export type MobileTab = 'home' | 'sales' | 'purchases' | 'contacts' | 'more';

const tabs: Array<{ id: MobileTab; label: string; icon: FinOpsIconName }> = [
  { id: 'home', label: 'Home', icon: 'dashboard' },
  { id: 'sales', label: 'Sales', icon: 'cash' },
  { id: 'purchases', label: 'Purchases', icon: 'vendor' },
  { id: 'contacts', label: 'Contacts', icon: 'customer' },
  { id: 'more', label: 'More', icon: 'settings' },
];

export function mobileTabHref(tab: MobileTab): string {
  return tab === 'home' ? '/mobile' : '/mobile?tab=' + tab;
}

export function MobileBottomNav({ activeTab, onSelect }: {
  activeTab: MobileTab;
  onSelect?: (tab: MobileTab) => void;
}) {
  const choose = (tab: MobileTab) => {
    onSelect?.(tab);
    window.history.replaceState({}, '', mobileTabHref(tab));
  };

  return (
    <nav aria-label="Mobile app navigation" className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-2 pt-2 shadow-[0_-6px_24px_rgba(15,23,42,.06)] backdrop-blur" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}>
      <div className="mx-auto grid max-w-xl grid-cols-4 gap-1">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <Link
              key={tab.id}
              href={mobileTabHref(tab.id)}
              aria-current={active ? 'page' : undefined}
              onClick={(event) => {
                if (!onSelect) return;
                event.preventDefault();
                choose(tab.id);
              }}
              className={'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ' + (active ? 'bg-violet-50 text-violet-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800')}
            >
              <FinOpsIcon name={tab.icon} className={'h-5 w-5 ' + (active ? 'text-violet-700' : 'text-slate-400')} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
