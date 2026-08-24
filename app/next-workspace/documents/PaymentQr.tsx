'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function PaymentQr({ value }: { value: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    if (!value) { setSrc(''); return () => { active = false; }; }
    QRCode.toDataURL(value, { width: 180, margin: 1, errorCorrectionLevel: 'M' })
      .then((data) => { if (active) setSrc(data); })
      .catch(() => { if (active) setSrc(''); });
    return () => { active = false; };
  }, [value]);
  if (!value || !src) return <div className="qr"><span>QR</span><small>Scan to pay</small></div>;
  return <div className="qr qr-real"><img src={src} alt="Invoice payment QR code" /><small>Scan to pay</small></div>;
}
