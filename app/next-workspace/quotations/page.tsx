'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { getPublicDocumentUrl, sharePublicDocument } from '@/lib/client/share-document';
import CopyButton from '@/components/ui/copy-button';
import { PageHeader } from '@/components/ui/finops/PageHeader';
import { Button, Card } from '@/components/moneymatters';

type QuotationRow = {
  id: string; customer_id: string; quotation_number: string; quotation_date: string;
  valid_until: string | null; status: string; currency_code: string; total: number | string;
  public_accept_token: string | null; invoice_id: string | null;
};
type CustomerRow = { id: string; display_name: string; legal_name: string | null };
const money = (amount: number, currency: string) => {
  const code = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : 'INR';
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(Number(amount || 0)); }
  catch { return code + ' ' + Number(amount || 0).toFixed(2); }
};
const dateLabel = (value?: string | null) => value ? new Date(value + 'T00:00:00').toLocaleDateString('en-IN') : '—';
const today = () => new Date().toISOString().slice(0, 10);
const statusLabel = (value: string, validUntil: string | null) => value === 'sent' && validUntil && validUntil < today() ? 'Sent · Expired' : value.charAt(0).toUpperCase() + value.slice(1);

export default function QuotationsListPage() {
  const [businessId, setBusinessId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('INR');
  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [customers, setCustomers] = useState<Record<string, CustomerRow>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [businessName, setBusinessName] = useState('Business');
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async (preferredBusinessId?: string) => {
    setLoading(true);
    setLoadError('');
    const contextResult = await supabase.rpc('get_my_business_context');
    if (contextResult.error) { setLoadError(contextResult.error.message); setLoading(false); return; }
    const contexts = (contextResult.data || []) as Array<BusinessContext & { business_id: string }>;
    const preferred = preferredBusinessId || (typeof window !== 'undefined' ? window.localStorage.getItem('moneymatters.activeBusinessId') || '' : '');
    const context = contexts.find(item => item.business_id === preferred) || contexts[0];
    if (!context?.business_id) { setLoadError('Business context not found. Select a business and try again.'); setLoading(false); return; }
    setBusinessId(context.business_id);
    setBusinessName(context.business_name || 'Business');
    setCurrencyCode(context.currency_code || 'INR');
    const quotationResult = await supabase.from('quotations')
      .select('id,customer_id,quotation_number,quotation_date,valid_until,status,currency_code,total,public_accept_token,invoice_id')
      .eq('business_id', context.business_id).order('created_at', { ascending: false });
    if (quotationResult.error) { setLoadError(quotationResult.error.message); setLoading(false); return; }
    const quotationRows = (quotationResult.data || []) as QuotationRow[];
    const customerIds = Array.from(new Set(quotationRows.map(row => row.customer_id).filter(Boolean)));
    const customerResult = customerIds.length
      ? await supabase.from('customers').select('id,display_name,legal_name').eq('business_id', context.business_id).in('id', customerIds)
      : { data: [], error: null };
    if (customerResult.error) { setLoadError(customerResult.error.message); setLoading(false); return; }
    const customerMap: Record<string, CustomerRow> = {};
    for (const customer of (customerResult.data || []) as CustomerRow[]) customerMap[customer.id] = customer;
    setRows(quotationRows);
    setCustomers(customerMap);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(row => {
      const customer = customers[row.customer_id];
      const matchesQuery = !query || [row.quotation_number, customer?.display_name, customer?.legal_name, row.status]
        .some(value => String(value || '').toLowerCase().includes(query));
      return matchesQuery && (statusFilter === 'all' || row.status === statusFilter);
    });
  }, [rows, customers, search, statusFilter]);

  const pdfUrl = (row: QuotationRow) => row.public_accept_token
    ? '/api/public-documents/pdf?type=quotation&token=' + encodeURIComponent(row.public_accept_token) : '';

  useEffect(() => {
    if (!openActionsId) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setOpenActionsId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenActionsId(null);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openActionsId]);

  const publicShareAvailable = (row: QuotationRow) => {
    const expired = row.status === 'sent' && Boolean(row.valid_until && row.valid_until < today());
    return ['sent', 'accepted', 'converted'].includes(row.status) && !expired;
  };

  const downloadPdf = async (row: QuotationRow) => {
    setActionFeedback(null);
    try {
      let token = row.public_accept_token || '';
      if (!token) {
        const publicUrl = await getPublicDocumentUrl('quotation', row.id);
        token = new URL(publicUrl).pathname.split('/').filter(Boolean).pop() || '';
      }
      if (!/^[A-Fa-f0-9]{48,128}$/.test(token)) throw new Error('The quotation does not have a valid public PDF token.');
      window.location.href = '/api/public-documents/pdf?type=quotation&token=' + encodeURIComponent(token);
      setOpenActionsId(null);
    } catch (error) {
      setActionFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to download this quotation PDF.' });
    }
  };

  const shareQuotation = async (row: QuotationRow) => {
    setActionFeedback(null);
    setSharingId(row.id);
    try {
      const publicUrl = await getPublicDocumentUrl('quotation', row.id);
      const customer = customers[row.customer_id];
      const result = await sharePublicDocument({
        documentType: 'quotation',
        businessName,
        customerName: customer?.legal_name || customer?.display_name || 'Customer',
        documentNumber: row.quotation_number,
        documentDate: row.quotation_date,
        totalAmount: Number(row.total || 0),
        currencyCode: row.currency_code || currencyCode,
        publicUrl,
      }, 'Quotation ' + row.quotation_number);
      setOpenActionsId(null);
      if (result === 'shared') setActionFeedback({ kind: 'success', message: 'Quotation shared using your device share sheet.' });
      else if (result === 'copied') setActionFeedback({ kind: 'success', message: 'Customer-ready quotation message copied to the clipboard.' });
    } catch (error) {
      setActionFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to share this quotation.' });
    } finally {
      setSharingId(null);
    }
  };

  return (
    <main className="min-h-screen bg-[#fbfaff] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <PageHeader
          breadcrumbs={[{ label: 'Workspace', href: '/next-workspace' }, { label: 'Sales & billing' }, { label: 'Quotations' }]}
          title="Quotations"
          subtitle="Manage customer quotations, edit the same document, download PDFs, and share secure links."
          badge={{ label: 'SALES', variant: 'pending' }}
          actions={<Button onClick={() => { window.location.href = '/next-workspace/quotation'; }}>+ New Quotation</Button>}
        />
        {loadError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{loadError}</div>}
        {actionFeedback && <div role={actionFeedback.kind === 'error' ? 'alert' : 'status'} className={'rounded-xl border p-3 text-sm ' + (actionFeedback.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>{actionFeedback.message}</div>}

        <Card className="overflow-hidden p-0">
          <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-center">
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search quotation no. or customer" aria-label="Search quotations" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filter by quotation status" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
              <option value="all">All statuses</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="converted">Converted</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option>
            </select>
            <Button variant="secondary" onClick={() => void refresh(businessId)} disabled={loading}>Refresh</Button>
          </div>
          {loading ? <div className="p-8 text-center text-sm text-slate-500">Loading quotations…</div>
            : filtered.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No quotations match this filter.</div>
            : <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-3">Quotation No.</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Date</th><th className="px-4 py-3 text-right">Total Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(row => {
                    const customer = customers[row.customer_id];
                    const expired = row.status === 'sent' && Boolean(row.valid_until && row.valid_until < today());
                    const isPublic = ['sent', 'accepted', 'converted'].includes(row.status);
                    const isEditable = ['draft', 'sent'].includes(row.status);
                    const pdf = pdfUrl(row);
                    return (
                      <tr key={row.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-4 font-semibold text-slate-900">{row.quotation_number}</td>
                        <td className="px-4 py-4">{customer?.legal_name || customer?.display_name || '—'}</td>
                        <td className="px-4 py-4 text-slate-600">{dateLabel(row.quotation_date)}</td>
                        <td className="px-4 py-4 text-right font-medium tabular-nums">{money(Number(row.total), row.currency_code || currencyCode)}</td>
                        <td className="px-4 py-4"><span className={'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ' + (row.status === 'converted' || row.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : row.status === 'sent' ? 'bg-sky-50 text-sky-700' : row.status === 'cancelled' || row.status === 'rejected' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700')}>{statusLabel(row.status, row.valid_until)}</span></td>
                        <td className="px-4 py-4">
                          <div className="relative flex justify-end" ref={openActionsId === row.id ? actionsRef : null}>
                            <button type="button" aria-haspopup="menu" aria-expanded={openActionsId === row.id} aria-label={'Actions for quotation ' + row.quotation_number} onClick={() => setOpenActionsId(current => current === row.id ? null : row.id)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
                              Actions <span aria-hidden="true" className="text-slate-500">▾</span>
                            </button>
                            {openActionsId === row.id && <div role="menu" aria-label={'Quotation actions for ' + row.quotation_number} className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                              <a role="menuitem" className="block rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50" href={'/next-workspace/documents?type=quotation&id=' + encodeURIComponent(row.id)}>View quotation</a>
                              {isEditable
                                ? <a role="menuitem" className="block rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50" href={'/next-workspace/quotation?edit=' + encodeURIComponent(row.id)}>Edit quotation</a>
                                : <button role="menuitem" type="button" disabled title="Accepted or converted quotations are locked against editing." className="block w-full cursor-not-allowed rounded-lg px-3 py-2.5 text-left text-sm text-slate-400">Edit quotation</button>}
                              {isPublic
                                ? <button role="menuitem" type="button" onClick={() => void downloadPdf(row)} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50">Download PDF</button>
                                : <button role="menuitem" type="button" disabled title="Send the quotation before creating a customer PDF." className="block w-full cursor-not-allowed rounded-lg px-3 py-2.5 text-left text-sm text-slate-400">Download PDF</button>}
                              {publicShareAvailable(row)
                                ? <CopyButton getValue={() => getPublicDocumentUrl('quotation', row.id)} label="Copy customer link" successMessage={'Customer link copied for ' + row.quotation_number + '.'} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50" />
                                : <button role="menuitem" type="button" disabled title={expired ? 'Extend validity before sharing this expired quotation.' : 'Send the quotation before sharing.'} className="block w-full cursor-not-allowed rounded-lg px-3 py-2.5 text-left text-sm text-slate-400">Copy customer link</button>}
                              {publicShareAvailable(row)
                                ? <button role="menuitem" type="button" disabled={sharingId === row.id} onClick={() => void shareQuotation(row)} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 disabled:opacity-50">{sharingId === row.id ? 'Preparing share…' : 'Share document'}</button>
                                : <button role="menuitem" type="button" disabled title={expired ? 'Extend validity before sharing this expired quotation.' : 'Send the quotation before sharing.'} className="block w-full cursor-not-allowed rounded-lg px-3 py-2.5 text-left text-sm text-slate-400">Share document</button>}
                            </div>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>}
        </Card>
        <p className="text-xs text-slate-500">Sent quotations past their validity date remain visible for audit. Edit the validity date before sharing or accepting them.</p>
      </div>
    </main>
  );
}
