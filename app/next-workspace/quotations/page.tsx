'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import { formatMoney } from '@/lib/i18n';
import { useLocale } from '@/lib/locale-context';
import { getPublicDocumentUrl, sharePublicDocument } from '@/lib/client/share-document';
import CopyButton from '@/components/ui/copy-button';
import { PageHeader } from '@/components/ui/finops/PageHeader';
import { Button, Card } from '@/components/moneymatters';

type QuotationRow = {
  id: string; customer_id: string; quotation_number: string; quotation_date: string;
  valid_until: string | null; status: string; currency_code: string; total: number | string;
  public_accept_token: string | null; invoice_id: string | null;
};
type CustomerRow = { id: string; display_name: string; legal_name: string | null; payment_terms_days: number };
type SortKey = 'quotation' | 'customer' | 'date' | 'amount' | 'status';
type SortDirection = 'asc' | 'desc';
const money = (amount: number, currency: string, locale: string) =>
  formatMoney(Number(amount || 0), currency || 'INR', locale, { maximumFractionDigits: 2 });
const dateLabel = (value?: string | null) => value ? new Date(value + 'T00:00:00').toLocaleDateString('en-IN') : '—';
const today = () => new Date().toISOString().slice(0, 10);
const statusLabel = (value: string, validUntil: string | null) => value === 'sent' && validUntil && validUntil < today() ? 'Sent · Expired' : value.charAt(0).toUpperCase() + value.slice(1);

export default function QuotationsListPage() {
  const { locale } = useLocale();
  const [businessId, setBusinessId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('INR');
  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [customers, setCustomers] = useState<Record<string, CustomerRow>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [pageSize, setPageSize] = useState('20');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [businessName, setBusinessName] = useState('Business');
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
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
      ? await supabase.from('customers').select('id,display_name,legal_name,payment_terms_days').eq('business_id', context.business_id).in('id', customerIds)
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

  const sorted = useMemo(() => {
    const result = [...filtered];
    const direction = sortDirection === 'asc' ? 1 : -1;
    const customerLabel = (row: QuotationRow) => {
      const customer = customers[row.customer_id];
      return String(customer?.legal_name || customer?.display_name || '').toLocaleLowerCase();
    };
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'quotation':
          comparison = a.quotation_number.localeCompare(b.quotation_number, undefined, { numeric: true, sensitivity: 'base' });
          break;
        case 'customer':
          comparison = customerLabel(a).localeCompare(customerLabel(b), undefined, { numeric: true, sensitivity: 'base' });
          break;
        case 'date':
          comparison = String(a.quotation_date || '').localeCompare(String(b.quotation_date || ''));
          break;
        case 'amount':
          comparison = Number(a.total || 0) - Number(b.total || 0);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status, undefined, { sensitivity: 'base' });
          break;
      }
      return (comparison || a.id.localeCompare(b.id)) * direction;
    });
    return result;
  }, [filtered, customers, sortBy, sortDirection]);

  useEffect(() => { setPage(1); }, [search, statusFilter, pageSize, sortBy, sortDirection]);

  const pages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(sorted.length / Number(pageSize)));
  const visible = pageSize === 'all' ? sorted : sorted.slice((page - 1) * Number(pageSize), page * Number(pageSize));
  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDirection(current => current === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDirection(key === 'quotation' || key === 'customer' || key === 'status' ? 'asc' : 'desc'); }
  };
  const sortIndicator = (key: SortKey) => sortBy === key ? (sortDirection === 'asc' ? '↑' : '↓') : '↕';

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

  const dueDateFor = (row: QuotationRow) => {
    const days = Math.max(0, Number(customers[row.customer_id]?.payment_terms_days || 0));
    return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  };

  const convertAcceptedQuotation = async (row: QuotationRow) => {
    setActionFeedback(null);
    setOpenActionsId(null);
    setProcessingId(row.id);
    try {
      const converted = await supabase.rpc('convert_quotation_to_invoice', {
        p_quotation_id: row.id,
        p_invoice_date: today(),
        p_due_date: dueDateFor(row),
      });
      if (converted.error) throw new Error(converted.error.message);
      await refresh(businessId);
      setActionFeedback({ kind: 'success', message: 'Quotation ' + row.quotation_number + ' converted to invoice ' + String(converted.data) + '.' });
    } catch (error) {
      await refresh(businessId);
      setActionFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to convert this accepted quotation.' });
    } finally {
      setProcessingId(null);
    }
  };

  const acceptQuotation = async (row: QuotationRow) => {
    setActionFeedback(null);
    setOpenActionsId(null);
    if (!['draft', 'sent'].includes(row.status)) return;
    if (row.status === 'sent' && row.valid_until && row.valid_until < today()) {
      setActionFeedback({ kind: 'error', message: 'Extend the validity date before accepting expired quotation ' + row.quotation_number + '.' });
      return;
    }
    setProcessingId(row.id);
    try {
      // A manually accepted draft is promoted through the existing permitted
      // lifecycle transitions rather than bypassing the database guard.
      if (row.status === 'draft') {
        const sent = await supabase.rpc('set_quotation_status', { p_quotation_id: row.id, p_status: 'sent' });
        if (sent.error) throw new Error(sent.error.message);
      }
      const accepted = await supabase.rpc('set_quotation_status', { p_quotation_id: row.id, p_status: 'accepted' });
      if (accepted.error) throw new Error(accepted.error.message);
      const converted = await supabase.rpc('convert_quotation_to_invoice', {
        p_quotation_id: row.id,
        p_invoice_date: today(),
        p_due_date: dueDateFor(row),
      });
      if (converted.error) throw new Error('Quotation was accepted, but invoice conversion failed: ' + converted.error.message);
      await refresh(businessId);
      setActionFeedback({ kind: 'success', message: 'Quotation ' + row.quotation_number + ' manually accepted and converted to invoice ' + String(converted.data) + '.' });
    } catch (error) {
      await refresh(businessId);
      setActionFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to accept this quotation.' });
    } finally {
      setProcessingId(null);
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
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 xl:flex-row xl:items-center">
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search quotation no. or customer" aria-label="Search quotations" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                Status
                <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filter by quotation status" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800">
                  <option value="all">All statuses</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="converted">Converted</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                Show
                <select value={pageSize} onChange={event => setPageSize(event.target.value)} aria-label="Rows per page" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800">
                  <option value="20">20</option><option value="50">50</option><option value="100">100</option><option value="all">All</option>
                </select>
              </label>
              <Button variant="secondary" onClick={() => void refresh(businessId)} disabled={loading}>Refresh</Button>
            </div>
          </div>
          {loading ? <div className="p-8 text-center text-sm text-slate-500">Loading quotations…</div>
            : sorted.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No quotations match this filter.</div>
            : <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    {([['quotation','Quotation No.'],['customer','Customer'],['date','Date'],['amount','Total Amount'],['status','Status']] as [SortKey,string][]).map(([key,label]) => (
                      <th key={key} aria-sort={sortBy === key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'} className={'px-4 py-3 ' + (key === 'amount' ? 'text-right' : '')}>
                        <button type="button" onClick={() => toggleSort(key)} className={'inline-flex items-center gap-1.5 rounded-md py-1 font-bold uppercase tracking-wide ' + (sortBy === key ? 'text-violet-700' : 'text-slate-500 hover:text-slate-800')}>
                          {label}<span aria-hidden="true" className={sortBy === key ? 'text-violet-600' : 'text-slate-300'}>{sortIndicator(key)}</span>
                        </button>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map(row => {
                    const customer = customers[row.customer_id];
                    const expired = row.status === 'sent' && Boolean(row.valid_until && row.valid_until < today());
                    const isPublic = ['sent', 'accepted', 'converted'].includes(row.status);
                    const isEditable = ['draft', 'sent'].includes(row.status);
                    return (
                      <tr key={row.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-4 font-semibold text-slate-900">{row.quotation_number}</td>
                        <td className="px-4 py-4">{customer?.legal_name || customer?.display_name || '—'}</td>
                        <td className="px-4 py-4 text-slate-600">{dateLabel(row.quotation_date)}</td>
                        <td className="px-4 py-4 text-right font-medium tabular-nums">{money(Number(row.total), row.currency_code || currencyCode, locale)}</td>
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
                              {(row.status === 'draft' || row.status === 'sent') && <button role="menuitem" type="button" disabled={processingId === row.id || expired} title={expired ? 'Extend validity before accepting this expired quotation.' : undefined} onClick={() => void acceptQuotation(row)} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-400">{processingId === row.id ? 'Processing…' : 'Mark as accepted'}</button>}
                              {row.status === 'accepted' && !row.invoice_id && <button role="menuitem" type="button" disabled={processingId === row.id} onClick={() => void convertAcceptedQuotation(row)} className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-emerald-50 disabled:opacity-50">{processingId === row.id ? 'Converting…' : 'Convert to invoice'}</button>}
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
          {!loading && sorted.length > 0 && <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span>Showing {(page - 1) * Number(pageSize === 'all' ? sorted.length || 1 : pageSize) + 1}–{pageSize === 'all' ? sorted.length : Math.min(page * Number(pageSize), sorted.length)} of {sorted.length}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1 || pageSize === 'all'} onClick={() => setPage(current => Math.max(1, current - 1))}>Previous</Button>
              <span>Page {page} / {pages}</span>
              <Button size="sm" variant="secondary" disabled={page >= pages || pageSize === 'all'} onClick={() => setPage(current => Math.min(pages, current + 1))}>Next</Button>
            </div>
          </div>}
        </Card>
        <p className="text-xs text-slate-500">Sent quotations past their validity date remain visible for audit. Edit the validity date before sharing or accepting them.</p>
      </div>
    </main>
  );
}
