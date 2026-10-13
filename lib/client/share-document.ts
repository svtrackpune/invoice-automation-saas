'use client';

import { supabase } from '@/lib/supabase';

type CanonicalDocumentType = 'invoice' | 'quotation' | 'receipt' | 'challan';
type PublicDocumentShareInput = {
  documentType: string;
  businessName: string;
  customerName: string;
  documentNumber: string;
  documentDate?: string | null;
  totalAmount: number;
  balanceDue?: number;
  currencyCode?: string;
  publicUrl?: string;
};

const TOKEN_PATTERN = /^[A-Fa-f0-9]{48,128}$/;
const PUBLIC_ORIGIN = 'https://mm.nilanga.in';

function canonicalType(type: string): CanonicalDocumentType | null {
  switch (String(type || '').trim().toLowerCase()) {
    case 'invoice':
    case 'tax_invoice':
    case 'cash_bill':
      return 'invoice';
    case 'quotation':
    case 'quote':
      return 'quotation';
    case 'receipt':
      return 'receipt';
    case 'challan':
    case 'delivery_challan':
      return 'challan';
    default:
      return null;
  }
}

function routeSegment(type: CanonicalDocumentType): string {
  if (type === 'quotation') return 'quote';
  if (type === 'challan') return 'delivery-challan';
  return type;
}

function publicOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === 'https:' && parsed.hostname === 'mm.nilanga.in') return parsed.origin;
    } catch {
      // Fall back to the pinned production origin below.
    }
  }
  return PUBLIC_ORIGIN;
}

function pathForToken(type: CanonicalDocumentType, token: string): string | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  return '/' + routeSegment(type) + '/' + token;
}

/** Build a canonical HTTPS URL from an already-known opaque public token. */
export function publicDocumentUrlFromToken(documentType: string, token: string): string {
  const type = canonicalType(documentType);
  if (!type) return '';
  const path = pathForToken(type, String(token || ''));
  return path ? new URL(path, publicOrigin()).toString() : '';
}

/** Resolve or issue a tenant-authorized public token through Postgres. */
export async function getPublicDocumentUrl(documentType: string, documentId: string): Promise<string> {
  const type = canonicalType(documentType);
  if (!type) throw new Error('This document type does not support public customer sharing.');
  if (!String(documentId || '').trim()) throw new Error('A document ID is required to create a public link.');

  const { data, error } = await supabase.rpc('get_public_document_link', {
    p_document_type: type,
    p_document_id: documentId,
  });
  if (error) throw new Error(error.message || 'Unable to create a public document link.');

  const path = data && typeof data === 'object' && 'path' in data ? String(data.path || '') : '';
  const expected = new RegExp('^/' + routeSegment(type) + '/[A-Fa-f0-9]{48,128}$');
  if (!expected.test(path) || path.includes('/next-workspace/')) {
    throw new Error('The server did not return a valid public customer link.');
  }

  const origin = publicOrigin();
  const url = new URL(path, origin);
  if (url.origin !== origin || url.pathname.startsWith('/next-workspace/')) {
    throw new Error('Only canonical public document URLs may be shared with customers.');
  }
  return url.toString();
}

export function canSharePublicDocument(documentType: string): boolean {
  return canonicalType(documentType) !== null;
}

function cleanLine(value: unknown, fallback: string): string {
  const result = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return result || fallback;
}

function money(value: number, currencyCode: string): string {
  const code = /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : 'INR';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(Number(value || 0));
  } catch {
    return 'INR ' + Number(value || 0).toFixed(2);
  }
}

function dateLabel(value?: string | null): string {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[3] + '/' + match[2] + '/' + match[1] : (raw || '—');
}

export function buildPublicDocumentShareMessage(input: PublicDocumentShareInput): string {
  const type = canonicalType(input.documentType);
  const label = type === 'quotation' ? 'Quotation' : type === 'receipt' ? 'Payment Receipt'
    : type === 'challan' ? 'Delivery Challan' : type === 'invoice' ? 'Invoice' : 'Document';
  const business = cleanLine(input.businessName, 'Business');
  const customer = cleanLine(input.customerName, 'Customer');
  const number = cleanLine(input.documentNumber, '—');
  const currency = String(input.currencyCode || 'INR').trim().toUpperCase();
  const lines = [
    '📄 *' + label + ' from ' + business + '*',
    '',
    'Dear ' + customer + ',',
    'Here are the details for your recent ' + label.toLowerCase() + ':',
    '',
    '• *Number:* ' + number,
    '• *Date:* ' + dateLabel(input.documentDate),
    '• *Total Amount:* ' + money(input.totalAmount, currency),
  ];
  if (input.balanceDue !== undefined && input.balanceDue !== null) {
    lines.push('• *Balance Due:* ' + money(input.balanceDue, currency));
  }
  if (input.publicUrl) lines.push('', '📥 *View & Download PDF:*', input.publicUrl);
  lines.push('', '──────────────────', '⚡ _Sent via Moneymatters FinOps — Join Moneymatters for free at https://mm.nilanga.in_');
  return lines.join('\n');
}

export function buildPublicDocumentSmsMessage(input: PublicDocumentShareInput): string {
  const type = canonicalType(input.documentType);
  const label = type === 'quotation' ? 'Quotation' : type === 'receipt' ? 'Payment Receipt'
    : type === 'challan' ? 'Delivery Challan' : type === 'invoice' ? 'Invoice' : 'Document';
  const business = cleanLine(input.businessName, 'Business');
  const number = cleanLine(input.documentNumber, '—');
  const currency = String(input.currencyCode || 'INR').trim().toUpperCase();
  const amount = money(input.totalAmount, currency);
  const balance = input.balanceDue !== undefined && input.balanceDue !== null
    ? ' Balance due ' + money(input.balanceDue, currency) + '.'
    : '';
  const link = input.publicUrl ? ' View: ' + input.publicUrl : '';
  return label + ' #' + number + ' from ' + business + '. Amount ' + amount + '.' + balance + link + ' - Moneymatters FinOps';
}


/**
 * Clipboard helper with a legacy DOM fallback for browsers/contexts where
 * navigator.clipboard is unavailable or denied.
 */
export async function copyTextToClipboard(value: string): Promise<void> {
  const text = String(value ?? '');
  if (!text) throw new Error('There is no text to copy.');

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Try the DOM fallback below.
    }
  }

  if (typeof document === 'undefined' || !document.body) {
    throw new Error('Clipboard access is unavailable in this browser.');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    textarea.remove();
  }
  if (!copied) throw new Error('The browser could not copy to the clipboard.');
}

export type PublicShareResult = 'shared' | 'copied' | 'cancelled';

/**
 * Share a customer-ready document message. On desktop browsers without a
 * native share sheet, copies the complete message—including the public URL.
 */
export async function sharePublicDocument(
  input: PublicDocumentShareInput,
  title: string,
): Promise<PublicShareResult> {
  const publicUrl = String(input.publicUrl || '').trim();
  if (!publicUrl) throw new Error('A public document link is required to share this document.');
  const message = buildPublicDocumentShareMessage({ ...input, publicUrl });

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text: message, url: publicUrl });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
      // Web Share can exist but fail in an unsupported browsing context.
    }
  }

  await copyTextToClipboard(message);
  return 'copied';
}
