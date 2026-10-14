const filenamePart = (value: unknown, fallback: string): string =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/-+$/g, '') || fallback;

/** Stable filename base used by browser print and every official PDF endpoint. */
export function buildDocumentFilenameBase(companyName: string, documentName: string, documentNumber: string): string {
  return [
    filenamePart(companyName, 'Business'),
    filenamePart(documentName, 'Document'),
    filenamePart(documentNumber, 'Document'),
  ].join('-');
}

export function buildDocumentDownloadFilename(companyName: string, documentName: string, documentNumber: string): string {
  return buildDocumentFilenameBase(companyName, documentName, documentNumber) + '.pdf';
}

export function documentFilenameLabel(type: string): string {
  const labels: Record<string, string> = {
    invoice: 'Invoice',
    tax_invoice: 'Tax-Invoice',
    quotation: 'Quotation',
    quote: 'Quotation',
    challan: 'Delivery-Challan',
    delivery_challan: 'Delivery-Challan',
    receipt: 'Receipt',
    cash_bill: 'Cash-Bill',
    purchase_order: 'Purchase-Order',
    credit_note: 'Credit-Note',
    debit_note: 'Debit-Note',
  };
  return labels[String(type || '').trim().toLowerCase()] || filenamePart(type, 'Document');
}
