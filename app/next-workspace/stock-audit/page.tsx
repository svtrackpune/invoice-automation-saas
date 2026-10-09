'use client';

import { useEffect, useState } from 'react';
import { supabase, type BusinessContext } from '@/lib/supabase';
import CameraBarcodeScanner from '@/components/barcode/CameraBarcodeScanner';
import { PageHeader } from '@/components/ui/finops/PageHeader';

type Item = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string | null;
  purchase_price: number;
};

type Balance = {
  product_service_id: string;
  quantity_on_hand: number;
  average_cost: number;
};

type Location = {
  id: string;
  name: string;
  is_default: boolean;
};

export default function StockAudit() {
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [location, setLocation] = useState('');
  const [actual, setActual] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const context = await supabase.rpc('get_my_business_context');
      const business = (context.data || [])[0] as BusinessContext | undefined;
      if (cancelled) return;
      if (!business) {
        window.location.href = '/';
        return;
      }
      setCtx(business);

      const [itemsResult, locationsResult] = await Promise.all([
        supabase
          .from('products_services')
          .select('id,name,sku,barcode,unit,purchase_price')
          .eq('business_id', business.business_id)
          .eq('is_active', true)
          .eq('inventory_tracked', true)
          .order('name'),
        supabase
          .from('inventory_locations')
          .select('id,name,is_default')
          .eq('business_id', business.business_id)
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .order('name'),
      ]);

      if (cancelled) return;
      if (itemsResult.error || locationsResult.error) {
        setError(itemsResult.error?.message || locationsResult.error?.message || 'Unable to load stock audit workspace.');
        setLoading(false);
        return;
      }

      const nextLocations = (locationsResult.data || []) as Location[];
      setItems((itemsResult.data || []) as Item[]);
      setLocations(nextLocations);
      const defaultLocation = nextLocations.find(x => x.is_default) || nextLocations[0];
      setLocation(defaultLocation?.id || '');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ctx || !location) {
      setBalances([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      const result = await supabase
        .from('inventory_balances')
        .select('product_service_id,quantity_on_hand,average_cost')
        .eq('business_id', ctx.business_id)
        .eq('location_id', location);

      if (cancelled) return;
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setBalances((result.data || []) as Balance[]);
      setActual({});
    })();
    return () => { cancelled = true; };
  }, [ctx?.business_id, location]);

  const balanceFor = (itemId: string) =>
    balances.find(balance => balance.product_service_id === itemId);

  const scanItem = (value: string) => {
    const query = value.trim().toLowerCase();
    if (!query) return;
    const item =
      items.find(x => (x.barcode || '').toLowerCase() === query) ||
      items.find(x => (x.sku || '').toLowerCase() === query) ||
      items.find(x => x.name.toLowerCase() === query) ||
      items.find(x => (x.barcode || '').toLowerCase().includes(query)) ||
      items.find(x => (x.sku || '').toLowerCase().includes(query));

    if (!item) {
      setError('No tracked product matches barcode/SKU "' + value.trim() + '".');
      return;
    }

    setError('');
    setNotice('Scanned ' + item.name + '. Physical count increased by 1.');
    setActual(current => {
      const system = Number(balanceFor(item.id)?.quantity_on_hand || 0);
      const currentCount = current[item.id] === undefined ? system : Number(current[item.id]);
      return { ...current, [item.id]: String(currentCount + 1) };
    });
  };

  const commit = async () => {
    if (!ctx || !location || busy) return;
    setBusy(true);
    setError('');
    setNotice('');

    const list = items.map(item => {
      const balance = balanceFor(item.id);
      const system = Number(balance?.quantity_on_hand || 0);
      const audited = actual[item.id] === undefined ? system : Number(actual[item.id]);
      return {
        product_id: item.id,
        recorded_qty: system,
        audited_qty: audited,
        unit_cost: Number(balance?.average_cost || item.purchase_price || 0),
      };
    });

    const invalid = list.find(row => !Number.isFinite(row.audited_qty) || row.audited_qty < 0);
    if (invalid) {
      setError('All physical quantities must be zero or greater.');
      setBusy(false);
      return;
    }

    const response = await supabase.rpc('commit_stock_audit_adjustment', {
      p_business_id: ctx.business_id,
      p_location_id: location,
      p_items: list,
    });

    if (response.error) {
      setError(response.error.message);
    } else {
      setNotice('Stock audit committed. Inventory balances and financial variance were settled.');
      setActual({});
      const refreshed = await supabase
        .from('inventory_balances')
        .select('product_service_id,quantity_on_hand,average_cost')
        .eq('business_id', ctx.business_id)
        .eq('location_id', location);
      setBalances((refreshed.data || []) as Balance[]);
    }
    setBusy(false);
  };

  if (!ctx || loading) {
    return <div className="grid min-h-[70vh] place-items-center bg-slate-50 text-sm text-slate-500">Loading Stock Audit…</div>;
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-7">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          breadcrumbs={[{ label: 'Workspace', href: '/next-workspace' }, { label: 'Inventory' }, { label: 'Stock Audit' }]}
          title="Stock Audit"
          subtitle="Compare recorded stock with the physical count and settle variance through inventory accounting."
          actions={<div className="flex flex-wrap items-center gap-2">
            <CameraBarcodeScanner onDetected={scanItem} compact label="Camera Scan" />
            <select value={location} onChange={event => setLocation(event.target.value)} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <option value="">Select location…</option>
              {locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button disabled={busy || !location || !items.length} onClick={() => void commit()} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Posting…' : 'Commit audit'}
            </button>
          </div>}
        />

        {error ? <div className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        {notice ? <div className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div> : null}

        <section className="rounded-2xl border border-slate-200/80 bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-slate-400">Scan a product barcode repeatedly to build the physical count. You can also edit quantities directly.</p>
            <p className="text-[10px] font-semibold text-slate-500">{items.length} tracked item{items.length === 1 ? '' : 's'} · {locations.find(x => x.id === location)?.name || 'No location'}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="p-3">Item</th><th className="p-3">System Qty</th><th className="p-3">Physical Qty</th><th className="p-3">Variance</th><th className="p-3">Avg cost</th></tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const balance = balanceFor(item.id);
                  const system = Number(balance?.quantity_on_hand || 0);
                  const value = actual[item.id] ?? String(system);
                  const physical = Number(value);
                  const variance = physical - system;
                  return (
                    <tr key={item.id} className="border-t border-slate-100">
                      <td className="p-3">
                        <div className="font-semibold">{item.name}</div>
                        <div className="mt-0.5 text-[10px] text-slate-400">{item.sku || item.barcode || 'No barcode / SKU'}</div>
                      </td>
                      <td className="p-3">{system} {item.unit || ''}</td>
                      <td className="p-3">
                        <input
                          className="w-28 rounded-lg border border-slate-200 p-2 font-mono"
                          type="number"
                          min="0"
                          step="0.01"
                          value={value}
                          onChange={event => setActual(current => ({ ...current, [item.id]: event.target.value }))}
                        />
                      </td>
                      <td className={'p-3 font-semibold ' + (variance < 0 ? 'text-rose-600' : variance > 0 ? 'text-emerald-600' : 'text-slate-400')}>
                        {variance > 0 ? '+' : ''}{variance}
                      </td>
                      <td className="p-3 font-mono">₹{Number(balance?.average_cost || item.purchase_price || 0).toLocaleString('en-IN')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!items.length ? <p className="py-10 text-center text-sm text-slate-400">No tracked products in this business.</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
