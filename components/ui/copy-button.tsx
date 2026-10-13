'use client';

import { useEffect, useRef, useState } from 'react';

type CopyButtonProps = {
  value?: string;
  getValue?: () => string | Promise<string>;
  label?: string;
  copiedLabel?: string;
  successMessage?: string;
  className?: string;
};

export default function CopyButton({
  value,
  getValue,
  label = 'Copy link',
  copiedLabel = 'Copied!',
  successMessage = 'Link copied to clipboard!',
  className = '',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      const text = getValue ? await getValue() : value;
      if (!text) throw new Error('No link is available to copy.');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setToast(successMessage);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
        setToast('');
      }, 2500);
    } catch {
      setCopied(false);
      setToast('Failed to copy link.');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(''), 2500);
    }
  };

  return <>
    <button type="button" onClick={copy} aria-live="polite" className={className}>
      {copied
        ? <svg aria-hidden="true" viewBox="0 0 24 24" className="mr-2 inline-block h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
        : <svg aria-hidden="true" viewBox="0 0 24 24" className="mr-2 inline-block h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>}
      {copied ? copiedLabel : label}
    </button>
    {toast && <div role="status" aria-live="polite" className={'fixed bottom-5 right-5 z-[200] rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg ' + (copied ? 'border-emerald-200 bg-white text-emerald-800' : 'border-rose-200 bg-white text-rose-700')}>{toast}</div>}
  </>;
}
