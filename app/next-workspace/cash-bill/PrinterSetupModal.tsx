'use client';

import { useEffect, useState } from 'react';
import {
  type PrinterConfig,
  type PrinterConnectionStatus,
  type RollWidth,
  ThermalPrinterService,
} from '@/lib/hardware/thermal-printer';

type Props = {
  open: boolean;
  service: ThermalPrinterService;
  status: PrinterConnectionStatus;
  onClose: () => void;
  onStatusChange: (status: PrinterConnectionStatus) => void;
};

export default function PrinterSetupModal({ open, service, status, onClose, onStatusChange }: Props) {
  const [config, setConfig] = useState<PrinterConfig>(() => service.getConfig());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setConfig(service.loadConfig());
    setMessage('');
    setError('');
  }, [open, service]);

  if (!open) return null;

  const update = (patch: Partial<PrinterConfig>) => {
    const next = service.saveConfig(patch);
    setConfig(next);
  };

  const connect = async (mode: 'bluetooth' | 'usb') => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const nextStatus =
        mode === 'bluetooth' ? await service.connectBluetooth() : await service.connectUsb();
      onStatusChange(nextStatus);
      setConfig(service.getConfig());
      setMessage(nextStatus.message + '.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to connect to printer.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await service.disconnect();
      onStatusChange(service.getStatus());
      setConfig(service.getConfig());
      setMessage('Printer disconnected.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to disconnect printer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/50 p-4">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-indigo-600">Counter hardware</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">Thermal Printer Setup</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-lg" aria-label="Close">
            ×
          </button>
        </header>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">
              Roll width
              <select
                value={config.rollWidth}
                onChange={(event) => update({ rollWidth: Number(event.target.value) as RollWidth })}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
              >
                <option value={58}>58mm (2-inch)</option>
                <option value={80}>80mm (3-inch)</option>
              </select>
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={config.autoKickCashDrawer}
                onChange={(event) => update({ autoKickCashDrawer: event.target.checked })}
                className="h-4 w-4 accent-indigo-600"
              />
              Auto-kick cash drawer on Cash tender
            </label>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <b className="text-sm text-slate-900">
                  {status.connected ? status.deviceName || 'Thermal printer' : 'Disconnected'}
                </b>
                <p className="mt-1 text-xs text-slate-500">
                  {status.connected ? status.transport.toUpperCase() + ' transport' : 'Connect a printer for silent thermal output.'}
                </p>
              </div>
              {status.connected ? (
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  disabled={busy}
                  className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                >
                  Disconnect
                </button>
              ) : null}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void connect('bluetooth')}
                disabled={busy}
                className="rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"
              >
                Connect Bluetooth Thermal Printer
              </button>
              <button
                type="button"
                onClick={() => void connect('usb')}
                disabled={busy}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 disabled:opacity-50"
              >
                Connect USB Thermal Printer
              </button>
            </div>
          </div>

          {!service.supportsBluetooth() && !service.supportsUsb() && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              Direct browser hardware APIs are unavailable here. The POS will fall back to the normal print dialog.
            </div>
          )}

          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{error}</div>}
          {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">{message}</div>}

          <p className="text-[11px] leading-5 text-slate-500">
            Bluetooth uses the browser GATT printer characteristic and writes in 512-byte chunks. USB uses WebUSB
            when the browser and operating system expose a writable endpoint.
          </p>
        </div>
      </section>
    </div>
  );
}