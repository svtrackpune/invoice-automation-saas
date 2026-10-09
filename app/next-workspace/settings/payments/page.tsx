'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/finops/PageHeader';

type BankAccount = {
  id: string; name: string | null; institution_name: string | null; account_last4: string | null;
  account_number: string | null; ifsc_code: string | null; branch_name: string | null;
  account_holder_name: string | null; linked_account_id: string | null; is_active: boolean;
};
type PaymentSettings = {
  business_id: string; upi_id: string; merchant_name: string; default_bank_account_id: string | null;
  enable_cash: boolean; enable_upi: boolean; enable_card: boolean; enable_credit: boolean;
  prefill_bill_amount: boolean; payment_qr_enabled: boolean; payment_instructions: string; qr_code_notes: string;
  payment_gateway_provider:'razorpay'|'cashfree'|'stripe'|null; payment_link_enabled:boolean;
  razorpay_enabled:boolean; razorpay_key_id:string; razorpay_key_secret:string; razorpay_webhook_secret:string; razorpay_credentials_configured:boolean; razorpay_webhook_configured:boolean;
  cashfree_enabled:boolean; cashfree_app_id:string; cashfree_environment:'sandbox'|'production'; cashfree_secret_key:string; cashfree_webhook_secret:string; cashfree_credentials_configured:boolean; cashfree_webhook_configured:boolean;
  stripe_enabled:boolean; stripe_publishable_key:string; stripe_secret_key:string; stripe_webhook_secret:string; stripe_credentials_configured:boolean; stripe_webhook_configured:boolean;
  gateway_convenience_fee_pct:number;
};
const emptySettings = (businessId: string): PaymentSettings => ({
  business_id: businessId, upi_id: '', merchant_name: '', default_bank_account_id: null,
  enable_cash: true, enable_upi: true, enable_card: true, enable_credit: true,
  prefill_bill_amount: true, payment_qr_enabled: true,
  payment_instructions: 'Scan with any UPI app to pay instantly', qr_code_notes: '',
  payment_gateway_provider:null, payment_link_enabled:false,
  razorpay_enabled:false,razorpay_key_id:'',razorpay_key_secret:'',razorpay_webhook_secret:'',razorpay_credentials_configured:false,razorpay_webhook_configured:false,
  cashfree_enabled:false,cashfree_app_id:'',cashfree_environment:'production',cashfree_secret_key:'',cashfree_webhook_secret:'',cashfree_credentials_configured:false,cashfree_webhook_configured:false,
  stripe_enabled:false,stripe_publishable_key:'',stripe_secret_key:'',stripe_webhook_secret:'',stripe_credentials_configured:false,stripe_webhook_configured:false,
  gateway_convenience_fee_pct:0,
});
const upiPattern = /^[\w.-]+@[\w.-]+$/;

export default function PaymentsSettingsPage() {
  const [businessId, setBusinessId] = useState('');
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [amount, setAmount] = useState('1.00');
  const [qrSvg, setQrSvg] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showBankModal, setShowBankModal] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);
  const [ifscLoading, setIfscLoading] = useState(false);
  const [bankForm, setBankForm] = useState({ name: '', institution_name: '', account_number: '', account_holder_name: '', ifsc_code: '', branch_name: '', linked_account_id: '' });

  const validVpa = Boolean(settings?.upi_id && upiPattern.test(settings.upi_id.trim()));
  const testAmount = Math.max(0.01, Number(amount) || 1);
  const testLink = useMemo(() => {
    if (!settings?.upi_id) return '';
    return 'upi://pay?pa=' + encodeURIComponent(settings.upi_id.trim()) + '&pn=' + encodeURIComponent(settings.merchant_name.trim())
      + '&am=' + testAmount.toFixed(2) + '&cu=INR&tn=Test%20Verification';
  }, [settings?.upi_id, settings?.merchant_name, testAmount]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const context = await supabase.rpc('get_my_business_context');
    const rows = (context.data || []) as Array<{ business_id: string }>;
    const saved = window.localStorage.getItem('moneymatters.activeBusinessId');
    const active = rows.find(row => row.business_id === saved) || rows[0];
    if (!active) { setError('No active business is available.'); setLoading(false); return; }
    setBusinessId(active.business_id);
    const [settingsResult, banksResult] = await Promise.all([
      supabase.rpc('get_payment_settings', { p_business_id: active.business_id }),
      supabase.from('bank_accounts').select('id,name,institution_name,account_last4,account_number,ifsc_code,branch_name,account_holder_name,linked_account_id,is_active').eq('business_id', active.business_id).eq('is_active', true).order('is_primary', { ascending: false }).order('name'),
    ]);
    if (settingsResult.error) setError(settingsResult.error.message);
    else setSettings({ ...emptySettings(active.business_id), ...(settingsResult.data as Partial<PaymentSettings>) });
    if (banksResult.error) setError(banksResult.error.message);
    else setBanks((banksResult.data || []) as BankAccount[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    if (!testLink || !validVpa) { setQrSvg(''); return () => { cancelled = true; }; }
    QRCode.toString(testLink, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 260 })
      .then(svg => { if (!cancelled) setQrSvg(svg); })
      .catch(() => { if (!cancelled) setQrSvg(''); });
    return () => { cancelled = true; };
  }, [testLink, validVpa]);

  function patch<K extends keyof PaymentSettings>(key: K, value: PaymentSettings[K]) {
    setSettings(current => current ? { ...current, [key]: value } : current);
  }

  const save = async () => {
    if (!settings) return;
    setSaving(true); setError(''); setMessage('');
    const result = await supabase.rpc('save_payment_settings', { p_business_id: businessId, p_payload: { ...settings, razorpay_key_secret: settings.razorpay_key_secret || undefined, razorpay_webhook_secret: settings.razorpay_webhook_secret || undefined, cashfree_secret_key: settings.cashfree_secret_key || undefined, cashfree_webhook_secret: settings.cashfree_webhook_secret || undefined, stripe_secret_key: settings.stripe_secret_key || undefined, stripe_webhook_secret: settings.stripe_webhook_secret || undefined } });
    if (result.error) setError(result.error.message);
    else { setSettings({ ...settings, ...(result.data as PaymentSettings), razorpay_key_secret:'', razorpay_webhook_secret:'', cashfree_secret_key:'', cashfree_webhook_secret:'', stripe_secret_key:'', stripe_webhook_secret:'' }); setMessage('Payment settings saved and synchronized.'); }
    setSaving(false);
  };

  const copyTestLink = async () => {
    if (!testLink) return;
    try { await navigator.clipboard.writeText(testLink); setMessage('Test UPI link copied.'); }
    catch { setError('Clipboard access is unavailable.'); }
  };

  const lookupIfsc = async () => {
    const ifsc = bankForm.ifsc_code.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) { setError('Enter a valid 11-character IFSC before lookup.'); return; }
    setIfscLoading(true); setError('');
    try {
      const response = await fetch('https://ifsc.razorpay.com/' + encodeURIComponent(ifsc));
      if (!response.ok) throw new Error('IFSC not found');
      const data = await response.json() as { BANK?: string; BRANCH?: string };
      setBankForm(current => ({ ...current, ifsc_code: ifsc, institution_name: data.BANK || current.institution_name, branch_name: data.BRANCH || current.branch_name }));
      setMessage('IFSC details loaded.');
    } catch { setError('IFSC lookup failed. You can still enter the bank details manually.'); }
    finally { setIfscLoading(false); }
  };

  const saveBank = async () => {
    const accountNumber = bankForm.account_number.trim();
    if (!businessId || !bankForm.name.trim() || !accountNumber || !bankForm.ifsc_code.trim()) { setError('Bank name, account number, and IFSC are required.'); return; }
    setBankSaving(true); setError('');
    const result = await supabase.rpc('create_payment_bank_account', {
      p_business_id: businessId,
      p_payload: {
        name: bankForm.name.trim(),
        institution_name: bankForm.institution_name.trim(),
        account_number: accountNumber,
        account_holder_name: bankForm.account_holder_name.trim(),
        ifsc_code: bankForm.ifsc_code.trim().toUpperCase(),
        branch_name: bankForm.branch_name.trim(),
        linked_account_id: bankForm.linked_account_id,
      },
    });
    if (result.error) setError(result.error.message);
    else {
      const bank = result.data as BankAccount;
      setBanks(current => [bank, ...current]); patch('default_bank_account_id', bank.id);
      setBankForm({ name: '', institution_name: '', account_number: '', account_holder_name: '', ifsc_code: '', branch_name: '', linked_account_id: '' });
      setShowBankModal(false); setMessage('Bank account added. Save the payment hub to make it authoritative.');
    }
    setBankSaving(false);
  };

  if (loading) return <div className="mx-auto max-w-7xl px-6 py-12 text-sm text-slate-500">Loading payment configuration…</div>;
  if (!settings) return <div className="mx-auto max-w-7xl px-6 py-12 text-sm text-rose-600">{error || 'Payment settings unavailable.'}</div>;

  const bankLabel = (bank: BankAccount) =>
    (bank.institution_name || bank.name || 'Bank') + ' · ••••' + (bank.account_last4 || bank.account_number?.slice(-4) || '----') + ' · ' + (bank.ifsc_code || 'IFSC pending');

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
<PageHeader breadcrumbs={[{label:'Workspace',href:'/next-workspace'},{label:'Settings & configuration',href:'/next-workspace/settings'},{label:'Payments & Banking'}]} title="Unified Payment Hub" subtitle="One authoritative configuration for invoices, receipts, Cash Bill and counter tenders." badge={{label:'Settings / Payments & Banking',variant:'treasury'}} actions={<button type="button" onClick={save} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">{saving ? 'Saving…' : 'Save Payment Settings'}</button>}/>
      {message ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{message}</div> : null}
      {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div> : null}

      <div className="mb-4"><section className="rounded-xl border border-slate-200 bg-white p-5"><div className="mb-4"><h2 className="text-sm font-bold text-slate-950">Payment Gateway Integrations</h2><p className="mt-1 text-[11px] text-slate-500">Merchant-specific Razorpay, Cashfree or Stripe credentials. Secrets are stored in Supabase Vault and never returned to the browser.</p></div><div className="grid gap-4 md:grid-cols-2"><label className="block"><span className="text-xs font-semibold text-slate-700">Default gateway</span><select value={settings.payment_gateway_provider||''} onChange={e=>patch('payment_gateway_provider',(e.target.value||null) as PaymentSettings['payment_gateway_provider'])} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"><option value="">Dynamic UPI only</option><option value="razorpay">Razorpay</option><option value="cashfree">Cashfree</option><option value="stripe">Stripe</option></select></label><label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.payment_link_enabled} onChange={e=>patch('payment_link_enabled',e.target.checked)}/> Enable payment-link generation</label></div><div className="mt-5 grid gap-4 lg:grid-cols-3"><div className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><b className="text-sm">Razorpay</b><input type="checkbox" checked={settings.razorpay_enabled} onChange={e=>patch('razorpay_enabled',e.target.checked)}/></div><div className="mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">{settings.razorpay_key_id.startsWith('rzp_live_')?'Live mode':settings.razorpay_key_id.startsWith('rzp_test_')?'Test mode':'Mode not detected'}</div><input value={settings.razorpay_key_id} onChange={e=>patch('razorpay_key_id',e.target.value)} placeholder="Key ID" className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"/><input type="password" value={settings.razorpay_key_secret} onChange={e=>patch('razorpay_key_secret',e.target.value)} placeholder={settings.razorpay_credentials_configured?'Stored in Vault · leave blank to keep':'Key Secret'} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" autoComplete="new-password"/><input type="password" value={settings.razorpay_webhook_secret} onChange={e=>patch('razorpay_webhook_secret',e.target.value)} placeholder={settings.razorpay_webhook_configured?'Stored in Vault · leave blank to keep':'Webhook secret'} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" autoComplete="new-password"/></div><div className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><b className="text-sm">Cashfree</b><input type="checkbox" checked={settings.cashfree_enabled} onChange={e=>patch('cashfree_enabled',e.target.checked)}/></div><select value={settings.cashfree_environment} onChange={e=>patch('cashfree_environment',e.target.value as PaymentSettings['cashfree_environment'])} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"><option value="production">Production</option><option value="sandbox">Sandbox</option></select><input value={settings.cashfree_app_id} onChange={e=>patch('cashfree_app_id',e.target.value)} placeholder="App ID" className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"/><input type="password" value={settings.cashfree_secret_key} onChange={e=>patch('cashfree_secret_key',e.target.value)} placeholder={settings.cashfree_credentials_configured?'Stored in Vault · leave blank to keep':'Secret Key'} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" autoComplete="new-password"/><input type="password" value={settings.cashfree_webhook_secret} onChange={e=>patch('cashfree_webhook_secret',e.target.value)} placeholder={settings.cashfree_webhook_configured?'Stored in Vault · leave blank to keep':'Webhook secret'} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" autoComplete="new-password"/></div><div className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><b className="text-sm">Stripe</b><input type="checkbox" checked={settings.stripe_enabled} onChange={e=>patch('stripe_enabled',e.target.checked)}/></div><input value={settings.stripe_publishable_key} onChange={e=>patch('stripe_publishable_key',e.target.value)} placeholder="Publishable key" className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"/><input type="password" value={settings.stripe_secret_key} onChange={e=>patch('stripe_secret_key',e.target.value)} placeholder={settings.stripe_credentials_configured?'Stored in Vault · leave blank to keep':'Secret key'} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" autoComplete="new-password"/><input type="password" value={settings.stripe_webhook_secret} onChange={e=>patch('stripe_webhook_secret',e.target.value)} placeholder={settings.stripe_webhook_configured?'Stored in Vault · leave blank to keep':'Webhook secret'} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" autoComplete="new-password"/></div></div><div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="mb-3"><h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Webhook endpoints</h3><p className="mt-1 text-[10px] text-slate-500">Canonical public endpoints for provider dashboard configuration.</p></div><div className="grid gap-2"><WebhookRow provider="Razorpay" path="/api/payments/webhook/razorpay"/><WebhookRow provider="Cashfree" path="/api/payments/webhook/cashfree"/><WebhookRow provider="Stripe" path="/api/payments/webhook/stripe"/></div></div><div className="mt-4 max-w-xs"><label className="block text-xs font-semibold text-slate-700">Gateway convenience fee %<input type="number" min="0" max="100" step="0.01" value={settings.gateway_convenience_fee_pct} onChange={e=>patch('gateway_convenience_fee_pct',Number(e.target.value)||0)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"/></label></div></section></div><div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(330px,.8fr)]">
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4"><h2 className="text-sm font-bold text-slate-950">UPI & Instant QR Configuration</h2><p className="mt-1 text-[11px] text-slate-500">Used by customer-facing invoices, receipts and the POS counter.</p></div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block"><span className="text-xs font-semibold text-slate-700">Primary UPI VPA / ID</span><input value={settings.upi_id} onChange={e => patch('upi_id', e.target.value.trim())} placeholder="svtrack@icici" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"/><span className={'mt-1 block text-[10px] ' + (validVpa ? 'text-emerald-600' : 'text-amber-600')}>{settings.upi_id ? (validVpa ? 'Valid VPA syntax.' : 'Expected format: name@provider') : 'Configure a VPA to enable UPI.'}</span></label>
              <label className="block"><span className="text-xs font-semibold text-slate-700">Merchant Payee Name</span><input value={settings.merchant_name} onChange={e => patch('merchant_name', e.target.value)} placeholder="Legal / trade name" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"/></label>
            </div>
            <label className="mt-4 block"><span className="text-xs font-semibold text-slate-700">Payment Instructions / Footer Note</span><textarea rows={2} value={settings.payment_instructions} onChange={e => patch('payment_instructions', e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"/></label>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Toggle label="Prefill Bill Amount by Default" checked={settings.prefill_bill_amount} onChange={v => patch('prefill_bill_amount', v)}/>
              <Toggle label="Display QR on Invoices & Thermal Receipts" checked={settings.payment_qr_enabled} onChange={v => patch('payment_qr_enabled', v)}/>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-sm font-bold text-slate-950">Settlement Bank Account</h2><p className="mt-1 text-[11px] text-slate-500">The default account for settlement and document payment context.</p></div><button type="button" onClick={() => setShowBankModal(true)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">+ Add New Bank Account</button></div>
            <select value={settings.default_bank_account_id || ''} onChange={e => patch('default_bank_account_id', e.target.value || null)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"><option value="">No default settlement account</option>{banks.map(bank => <option key={bank.id} value={bank.id}>{bankLabel(bank)}</option>)}</select>
            {banks.length === 0 ? <p className="mt-2 text-[10px] text-amber-600">No active bank account is configured for this business.</p> : null}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4"><h2 className="text-sm font-bold text-slate-950">Counter Tender Method Policies</h2><p className="mt-1 text-[11px] text-slate-500">Controls which tender methods are available at the POS counter.</p></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle label="Cash (Drawer kick enabled)" checked={settings.enable_cash} onChange={v => patch('enable_cash', v)}/>
              <Toggle label="UPI / QR Code" checked={settings.enable_upi} onChange={v => patch('enable_upi', v)}/>
              <Toggle label="Card / POS EDC Machine" checked={settings.enable_card} onChange={v => patch('enable_card', v)}/>
              <Toggle label="Customer Credit / Khata" checked={settings.enable_credit} onChange={v => patch('enable_credit', v)}/>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-20 xl:h-fit">
          <div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-bold text-slate-950">Live NPCI QR Test Simulator</h2><p className="mt-1 text-[11px] text-slate-500">Exact payment intent generated from the current VPA and payee.</p></div><span className={'rounded-full px-2.5 py-1 text-[10px] font-bold ' + (validVpa ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{validVpa ? 'Ready for Counter & POS Scanning' : 'Configuration Incomplete'}</span></div>
          <div className="mt-5 rounded-xl bg-slate-50 p-5 text-center">
            {qrSvg ? <div className="mx-auto w-fit rounded-lg bg-white p-3" dangerouslySetInnerHTML={{ __html: qrSvg }} /> : <div className="mx-auto grid h-64 max-w-64 place-items-center rounded-lg border border-dashed border-slate-300 bg-white text-xs text-slate-400">{validVpa ? 'Generating QR…' : 'Enter a valid VPA to preview the QR.'}</div>}
            <label className="mx-auto mt-4 block max-w-64 text-left"><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Test Amount</span><div className="mt-1 flex items-center rounded-lg border border-slate-200 bg-white"><span className="pl-3 text-sm text-slate-500">₹</span><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="w-full bg-transparent px-2 py-2.5 text-sm font-semibold outline-none"/></div></label>
            <p className="mt-3 break-all text-[10px] leading-4 text-slate-400">{testLink || 'upi://pay?...'}</p>
            <button type="button" onClick={copyTestLink} disabled={!testLink} className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40">Copy Test UPI Link</button>
          </div>
          <p className="mt-4 text-[10px] leading-4 text-slate-500">Syntax validation is local; a successful scan still depends on the VPA being active with its issuer.</p>
        </section>
      </div>

      {showBankModal ? <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/30 p-4" role="dialog" aria-modal="true" aria-label="Add bank account">
        <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
          <div className="flex items-center justify-between"><div><h2 className="text-base font-bold text-slate-950">Add Settlement Bank Account</h2><p className="mt-1 text-[11px] text-slate-500">Map the bank record to an existing ledger account when available.</p></div><button type="button" onClick={() => setShowBankModal(false)} className="text-slate-400">✕</button></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input label="Bank Display Name" value={bankForm.name} onChange={v => setBankForm(f => ({ ...f, name: v }))}/>
            <Input label="Account Holder Name" value={bankForm.account_holder_name} onChange={v => setBankForm(f => ({ ...f, account_holder_name: v }))}/>
            <div><Input label="IFSC Code" value={bankForm.ifsc_code} onChange={v => setBankForm(f => ({ ...f, ifsc_code: v.toUpperCase() }))}/><button type="button" onClick={lookupIfsc} disabled={ifscLoading} className="mt-1 text-[10px] font-semibold text-indigo-600">{ifscLoading ? 'Looking up…' : 'Lookup IFSC details'}</button></div>
            <Input label="Institution / Bank" value={bankForm.institution_name} onChange={v => setBankForm(f => ({ ...f, institution_name: v }))}/>
            <Input label="Branch" value={bankForm.branch_name} onChange={v => setBankForm(f => ({ ...f, branch_name: v }))}/>
            <Input label="Account Number" value={bankForm.account_number} onChange={v => setBankForm(f => ({ ...f, account_number: v }))} type="password"/>
            <Input label="Ledger Account ID (optional)" value={bankForm.linked_account_id} onChange={v => setBankForm(f => ({ ...f, linked_account_id: v }))}/>
          </div>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowBankModal(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold">Cancel</button><button type="button" onClick={saveBank} disabled={bankSaving} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white">{bankSaving ? 'Adding…' : 'Add Bank Account'}</button></div>
        </div>
      </div> : null}
    </div>
  );
}

function WebhookRow({ provider, path }: { provider: string; path: string }) { const [copied,setCopied]=useState(false); const url=typeof window!=='undefined'?window.location.origin+path:'https://mm.nilanga.in'+path; const copy=async()=>{try{await navigator.clipboard.writeText(url);setCopied(true);window.setTimeout(()=>setCopied(false),1500);}catch{}}; return <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><span className="w-20 shrink-0 text-xs font-semibold text-slate-700">{provider}</span><code className="min-w-0 flex-1 truncate text-[10px] text-slate-500">{url}</code><button type="button" onClick={copy} className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold">{copied?'Copied':'Copy'}</button></div>; }

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5"><span className="text-xs font-medium text-slate-700">{label}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 accent-indigo-600"/></label>;
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="block"><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span><input type={type} value={value} onChange={e => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"/></label>;
}
