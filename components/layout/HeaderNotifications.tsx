'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { FinOpsIcon } from '@/components/ui/finops/FinOpsPrimitives';

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
};

export default function HeaderNotifications({ businessId }: { businessId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!businessId) return;
    const [listResult, countResult] = await Promise.all([
      supabase.from('notifications')
        .select('id,type,title,message,data,is_read,created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(8),
      supabase.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('is_read', false),
    ]);
    if (!listResult.error) setItems((listResult.data || []) as NotificationRow[]);
    if (!countResult.error) setUnreadCount(countResult.count || 0);
  }, [businessId]);

  useEffect(() => {
    void refresh();
    const channel = supabase.channel('workspace-notifications:' + businessId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: 'business_id=eq.' + businessId,
      }, () => { void refresh(); })
      .subscribe();
    const poll = window.setInterval(() => { void refresh(); }, 30000);
    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [businessId, refresh]);

  const markRead = async (row: NotificationRow) => {
    if (row.is_read) return;
    const result = await supabase.from('notifications')
      .update({ is_read: true })
      .eq('id', row.id)
      .eq('business_id', businessId);
    if (result.error) return;
    setItems(current => current.map(item => item.id === row.id ? { ...item, is_read: true } : item));
    setUnreadCount(current => Math.max(0, current - 1));
  };

  const openNotification = async (row: NotificationRow) => {
    await markRead(row);
    setOpen(false);
    const data = row.data || {};
    const invoiceId = typeof data.invoice_id === 'string' ? data.invoice_id : '';
    const quotationId = typeof data.quotation_id === 'string' ? data.quotation_id : '';
    if (invoiceId) {
      window.location.href = '/next-workspace/documents?type=invoice&id=' + encodeURIComponent(invoiceId);
    } else if (quotationId) {
      window.location.href = '/next-workspace/documents?type=quotation&id=' + encodeURIComponent(quotationId);
    }
  };

  const markAllRead = async () => {
    if (!businessId || unreadCount === 0) return;
    setLoading(true);
    const result = await supabase.from('notifications')
      .update({ is_read: true })
      .eq('business_id', businessId)
      .eq('is_read', false);
    setLoading(false);
    if (result.error) return;
    setItems(current => current.map(item => ({ ...item, is_read: true })));
    setUnreadCount(0);
  };

  return <div className="relative">
    <button type="button" title="Notifications" aria-label={'Notifications' + (unreadCount ? ', ' + unreadCount + ' unread' : '')}
      aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen(value => !value); if (!open) void refresh(); }}
      className="relative grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
      <FinOpsIcon name="bell" />
      {unreadCount > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-orange-600 px-1 text-center text-[10px] font-bold leading-4 text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {open && <section role="dialog" aria-label="Workspace notifications" className="absolute right-0 top-11 z-[120] w-[min(92vw,360px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div><h2 className="text-sm font-bold text-slate-900">Notifications</h2><p className="text-[11px] text-slate-500">{unreadCount} unread</p></div>
        <button type="button" onClick={markAllRead} disabled={loading || unreadCount===0} className="text-xs font-semibold text-violet-700 hover:text-violet-900 disabled:opacity-40">Mark all read</button>
      </header>
      <div className="max-h-[min(65vh,420px)] overflow-y-auto">
        {items.length===0 && <p className="px-4 py-8 text-center text-sm text-slate-500">You’re all caught up.</p>}
        {items.map(item => <button key={item.id} type="button" onClick={() => void openNotification(item)} className={'block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ' + (!item.is_read ? 'bg-violet-50/50' : '')}>
          <span className="flex items-start gap-2">
            <span className={'mt-1.5 h-2 w-2 shrink-0 rounded-full ' + (!item.is_read ? 'bg-violet-600' : 'bg-transparent')}/>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold text-slate-900">{item.title}</span>
              <span className="mt-1 block whitespace-normal text-xs leading-5 text-slate-600">{item.message}</span>
              <span className="mt-1 block text-[10px] text-slate-400">{new Date(item.created_at).toLocaleString('en-IN')}</span>
            </span>
          </span>
        </button>)}
      </div>
    </section>}
  </div>;
}
