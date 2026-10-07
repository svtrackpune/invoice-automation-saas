'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type DetectedCode = { rawValue?: string };
type DetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedCode[]> };
type DetectorCtor = new (options?: { formats?: string[] }) => DetectorLike;

type Props = {
  onDetected: (value: string) => void;
  label?: string;
  compact?: boolean;
};

const PREFERRED_FORMATS = [
  'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e',
  'itf', 'codabar', 'data_matrix', 'qr_code',
];

export default function CameraBarcodeScanner({ onDetected, label = 'Scan Barcode', compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [supportsCamera, setSupportsCamera] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const detectingRef = useRef(false);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    detectingRef.current = false;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStarting(false);
  }, []);

  const detectLoop = useCallback(async (detector: DetectorLike) => {
    if (!videoRef.current || detectingRef.current || !streamRef.current) return;
    detectingRef.current = true;
    try {
      const results = await detector.detect(videoRef.current);
      const code = results.find(item => String(item.rawValue ?? '').trim())?.rawValue?.trim();
      if (code) {
        if ('vibrate' in navigator && typeof navigator.vibrate === 'function') navigator.vibrate(80);
        onDetected(code);
        setOpen(false);
        stop();
        return;
      }
    } catch {
      // A single failed frame should not terminate the camera session.
    } finally {
      detectingRef.current = false;
    }
    if (streamRef.current && open) {
      timerRef.current = window.setTimeout(() => void detectLoop(detector), 140);
    }
  }, [onDetected, open, stop]);

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }

    let cancelled = false;
    const start = async () => {
      setStarting(true);
      setError('');

      if (!window.isSecureContext) {
        setSupportsCamera(false);
        setError('Camera scanning requires a secure HTTPS page.');
        setStarting(false);
        return;
      }

      const mediaDevices = navigator.mediaDevices;
      const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      if (!mediaDevices?.getUserMedia || !Detector) {
        setSupportsCamera(false);
        setError('This browser does not provide the Barcode Detection API. Use manual barcode entry or a hardware scanner.');
        setStarting(false);
        return;
      }

      try {
        const stream = await mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;
        if (!videoRef.current) throw new Error('Camera preview is unavailable.');
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        let formats = PREFERRED_FORMATS;
        const getSupportedFormats = (Detector as unknown as { getSupportedFormats?: () => Promise<string[]> }).getSupportedFormats;
        if (getSupportedFormats) {
          const supported = await getSupportedFormats();
          const preferred = supported.filter(format => PREFERRED_FORMATS.includes(format));
          if (preferred.length) formats = preferred;
        }

        const detector = new Detector({ formats });
        setStarting(false);
        await detectLoop(detector);
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        const message = name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access and try again.'
          : name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : name === 'NotReadableError'
              ? 'The camera is currently busy in another application.'
              : err instanceof Error ? err.message : 'Unable to start the camera.';
        setError(message);
        setStarting(false);
        stop();
      }
    };

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, stop, detectLoop]);

  const submitManual = () => {
    const value = manual.trim();
    if (!value) return;
    onDetected(value);
    setManual('');
    setOpen(false);
    stop();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setSupportsCamera(true); setError(''); }}
        className={compact
          ? 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50'
          : 'inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100'}
      >
        <span aria-hidden>⌁</span>
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/60 p-4">
          <section role="dialog" aria-modal="true" aria-label="Camera barcode scanner" className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[.16em] text-indigo-600">Barcode scanner</p>
                <h2 className="text-sm font-bold text-slate-950">Scan product barcode</h2>
              </div>
              <button type="button" onClick={() => { setOpen(false); stop(); }} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600" aria-label="Close scanner">×</button>
            </header>

            <div className="p-4">
              <div className="relative overflow-hidden rounded-xl bg-slate-950">
                <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" />
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="h-28 w-[78%] rounded-lg border-2 border-white/80 shadow-[0_0_0_999px_rgba(15,23,42,.28)]" />
                </div>
                {starting && <div className="absolute inset-x-0 bottom-0 bg-slate-950/75 px-3 py-2 text-center text-xs font-semibold text-white">Starting camera…</div>}
              </div>

              {!supportsCamera || error ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                  <b>{error || 'Camera scanner is unavailable in this browser.'}</b>
                  <p className="mt-1">You can enter the barcode manually or use a USB/Bluetooth scanner, which behaves like a keyboard.</p>
                </div>
              ) : (
                <p className="mt-3 text-center text-xs text-slate-500">Center the barcode inside the frame. The scan is added automatically when detected.</p>
              )}

              <div className="mt-4 border-t border-slate-100 pt-4">
                <label className="text-[9px] font-bold uppercase tracking-[.14em] text-slate-400">Manual barcode</label>
                <div className="mt-1 flex gap-2">
                  <input
                    value={manual}
                    onChange={event => setManual(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submitManual(); } }}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Enter SKU / barcode"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 font-mono text-sm outline-none focus:border-indigo-400"
                  />
                  <button type="button" onClick={submitManual} disabled={!manual.trim()} className="rounded-lg bg-slate-900 px-4 text-xs font-bold text-white disabled:opacity-40">Use</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
