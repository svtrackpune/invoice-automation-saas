type GenericRecord = Record<string, unknown>;

const value = (record: GenericRecord | null | undefined, ...keys: string[]) => {
  for (const key of keys) {
    const candidate = record?.[key];
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) return String(candidate).trim();
  }
  return '';
};

export type ReceiptAllocation = {
  invoiceNumber: string;
  totalDue: number;
  amountApplied: number;
  remainingBalance: number;
};

export type TaxLine = {
  invoice_item_id: string | null;
  tax_code: string | null;
  tax_category: string | null;
  rate: number | null;
  taxable_amount: number | null;
  tax_amount: number | null;
};

export function TaxInvoiceCompliance({
  payload,
  business,
  customer,
}: {
  payload: GenericRecord;
  business: GenericRecord;
  customer: GenericRecord;
}) {
  const supplierGstin = value(business, 'tax_registration_number', 'gstin', 'tax_id');
  const buyerGstin = value(customer, 'tax_id', 'gstin', 'tax_registration_number');
  const supplierState = value(business, 'state_name', 'state', 'address_state');
  const supplierStateCode = value(business, 'state_code', 'address_state_code');
  const place = value(payload, 'place_of_supply_state_name', 'place_of_supply_state', 'place_of_supply_state_code', 'place_of_supply');
  const irn = value(payload, 'irn', 'irn_number', 'einvoice_irn');
  const signedQr = value(payload, 'signed_qr_code', 'signed_qr', 'qr_code_data');
  const reverseCharge = Boolean(payload.reverse_charge);

  return (
    <section className="print-compliance tax-invoice-compliance">
      <div className="print-copy-badge"><strong>TAX INVOICE</strong><span>{value(payload, 'copy_type_label', 'copy_type') || 'Original for Recipient'}</span></div>
      <div className="print-compliance-grid">
        <div><span>Supplier GSTIN</span><strong>{supplierGstin || '—'}</strong></div>
        <div><span>Buyer GSTIN</span><strong>{buyerGstin || '—'}</strong></div>
        <div><span>State Name</span><strong>{supplierState || '—'}</strong></div>
        <div><span>State Code</span><strong>{supplierStateCode || '—'}</strong></div>
        <div><span>Place of Supply</span><strong>{place || '—'}</strong></div>
        <div><span>Reverse Charge</span><strong>{reverseCharge ? 'Yes' : 'No'}</strong></div>
      </div>
      {(irn || signedQr) && (
        <div className="print-einvoice-strip">
          {irn && <div><span>IRN</span><code>{irn}</code></div>}
          {signedQr && <div><span>Signed QR / e-Invoice data</span><code>{signedQr.slice(0, 90)}{signedQr.length > 90 ? '…' : ''}</code></div>}
        </div>
      )}
    </section>
  );
}

export function ReceiptSettlement({
  receiptNumber,
  date,
  method,
  reference,
  customerName,
  outstanding,
  allocations,
}: {
  receiptNumber: string;
  date: string;
  method: string;
  reference: string;
  customerName: string;
  outstanding: number;
  allocations: ReceiptAllocation[];
}) {
  return (
    <>
      <section className="print-compliance receipt-settlement">
        <div><span>Receipt Number</span><strong>{receiptNumber || '—'}</strong></div>
        <div><span>Payment Date</span><strong>{date || '—'}</strong></div>
        <div><span>Payment Method</span><strong>{method || '—'}</strong></div>
        <div><span>Transaction / UTR / Cheque Ref.</span><strong>{reference || '—'}</strong></div>
      </section>
      <section className="receipt-acknowledgment">
        Received with thanks from <strong>{customerName || 'Customer'}</strong>.
        <span>Current outstanding ledger balance: <strong>INR {outstanding.toFixed(2)}</strong></span>
      </section>
      <section className="receipt-allocation">
        <div className="print-section-title">Invoice Allocation</div>
        {allocations.length ? (
          <table>
            <thead><tr><th>Invoice No.</th><th>Total Due</th><th>Amount Applied</th><th>Remaining Balance</th></tr></thead>
            <tbody>{allocations.map((row) => (
              <tr key={row.invoiceNumber}><td>{row.invoiceNumber}</td><td>₹{row.totalDue.toFixed(2)}</td><td>₹{row.amountApplied.toFixed(2)}</td><td>₹{row.remainingBalance.toFixed(2)}</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="muted">No allocation rows were recorded against this receipt.</p>}
      </section>
    </>
  );
}

export function DeliveryChallanCompliance({ payload, customer }: { payload: GenericRecord; customer: GenericRecord }) {
  const billing = value(customer, 'billing_address', 'address');
  const delivery = value(payload, 'consignee_address', 'delivery_address', 'place_of_delivery') || value(customer, 'shipping_address', 'address');
  return (
    <>
      <section className="print-statutory-banner">Supply on Approval / Job Work / Exhibition / Transportation Only — Not for Sale / Not a Tax Invoice</section>
      <section className="print-compliance logistics-strip">
        <div><span>Dispatch Date</span><strong>{value(payload, 'challan_date', 'document_date') || '—'}</strong></div>
        <div><span>Vehicle Number</span><strong>{value(payload, 'vehicle_number') || '—'}</strong></div>
        <div><span>Transporter</span><strong>{value(payload, 'transporter_name') || '—'}</strong></div>
        <div><span>Mode</span><strong>{value(payload, 'transport_mode', 'transport_mode_name') || '—'}</strong></div>
        <div><span>E-Way Bill</span><strong>{value(payload, 'eway_bill_number', 'ewb_number') || '—'}</strong></div><div><span>Number of Packages</span><strong>{value(payload, 'number_of_packages', 'packages') || '—'}</strong></div>
      </section>
      <section className="delivery-address-grid">
        <div><label>Billing Address (Buyer)</label><p>{billing || '—'}</p></div>
        <div><label>Consignee / Place of Delivery</label><p>{delivery || '—'}</p></div>
      </section>
    </>
  );
}

export function PurchaseOrderCompliance({ payload, business, vendor }: { payload: GenericRecord; business: GenericRecord; vendor: GenericRecord }) {
  return (
    <>
      <section className="print-compliance logistics-strip">
        <div><span>PO Number</span><strong>{value(payload, 'document_number', 'po_number', 'bill_number') || '—'}</strong></div>
        <div><span>Order Date</span><strong>{value(payload, 'document_date', 'bill_date') || '—'}</strong></div>
        <div><span>Expected Delivery</span><strong>{value(payload, 'expected_delivery_date', 'delivery_date', 'due_date') || '—'}</strong></div>
        <div><span>Delivery Location</span><strong>{value(payload, 'delivery_location', 'warehouse_address', 'place_of_delivery') || value(business, 'address') || '—'}</strong></div>
      </section>
      <section className="delivery-address-grid">
        <div><label>Buyer / Merchant</label><p>{value(business, 'legal_name', 'name') || '—'}</p></div>
        <div><label>Supplier / Vendor</label><p>{value(vendor, 'legal_name', 'display_name', 'name') || '—'}</p></div>
      </section>
      <section className="print-procurement-note">
        This is a formal procurement order subject to supplier acceptance. This is not a tax invoice or liability voucher.
      </section>
    </>
  );
}

export function CreditNoteCompliance({ payload, originalInvoiceNumber, originalInvoiceDate }: { payload: GenericRecord; originalInvoiceNumber: string; originalInvoiceDate: string }) {
  return (
    <>
      <section className="print-compliance credit-note-compliance">
        <div className="print-copy-badge"><strong>CREDIT NOTE</strong><span>Section 34 · CGST Act</span></div>
        <div className="print-compliance-grid">
          <div><span>Original Invoice Number</span><strong>{originalInvoiceNumber || '—'}</strong></div>
          <div><span>Original Invoice Date</span><strong>{originalInvoiceDate || '—'}</strong></div>
          <div><span>Reason for Issuance</span><strong>{value(payload, 'reason') || '—'}</strong></div>
        </div>
      </section>
    </>
  );
}

export function CashBillCompliance({ payload, cashierName, paymentReference }: { payload: GenericRecord; cashierName: string; paymentReference: string }) {
  return (
    <section className="cash-bill-meta">
      <div className="cash-paid-watermark">PAID IN FULL</div>
      <div><span>Cashier</span><strong>{cashierName || 'Counter Cashier'}</strong></div>
      <div><span>UPI / Transaction Reference</span><strong>{paymentReference || '—'}</strong></div>
    </section>
  );
}

export function TaxSummaryGrid({
  items,
  taxLines,
  money,
}: {
  items: GenericRecord[];
  taxLines: TaxLine[];
  money: (value: number) => string;
}) {
  const linesByItem = new Map<string, TaxLine[]>();
  for (const row of taxLines) {
    const key = String(row.invoice_item_id || '');
    const current = linesByItem.get(key) || [];
    current.push(row);
    linesByItem.set(key, current);
  }
  const grouped = new Map<string, { taxable: number; cgstRate: number; cgst: number; sgstRate: number; sgst: number; igstRate: number; igst: number; totalTax: number }>();
  for (const item of items) {
    const key = String(item.hsn_sac || item.description || item.name || 'Unclassified');
    const itemTaxLines = linesByItem.get(String(item.id || item.invoice_item_id || item.product_service_id || '')) || [];
    const current = grouped.get(key) || { taxable: Math.max(0, Number(item.line_total || item.amount || 0) - Number(item.tax_amount || 0)), cgstRate: 0, cgst: 0, sgstRate: 0, sgst: 0, igstRate: 0, igst: 0, totalTax: itemTaxLines.length ? 0 : Number(item.tax_amount || 0) };
    for (const tax of itemTaxLines) {
      const category = String(tax.tax_category || tax.tax_code || '').toUpperCase();
      const amount = Number(tax.tax_amount || 0);
      const rate = Number(tax.rate || 0);
      if (category.includes('CGST')) { current.cgstRate = rate; current.cgst += amount; }
      else if (category.includes('SGST') || category.includes('UTGST')) { current.sgstRate = rate; current.sgst += amount; }
      else if (category.includes('IGST')) { current.igstRate = rate; current.igst += amount; }
      current.totalTax += amount;
    }
    grouped.set(key, current);
  }
  return (
    <section className="print-tax-summary">
      <div className="print-section-title">HSN / SAC & GST Summary</div>
      <table>
        <thead><tr><th>HSN / SAC</th><th>Taxable Value</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total Tax</th></tr></thead>
        <tbody>{Array.from(grouped.entries()).map(([key,row]) => (
          <tr key={key}><td>{key}</td><td>{money(row.taxable)}</td><td>{row.cgst ? row.cgstRate.toFixed(2)+'% · '+money(row.cgst) : '—'}</td><td>{row.sgst ? row.sgstRate.toFixed(2)+'% · '+money(row.sgst) : '—'}</td><td>{row.igst ? row.igstRate.toFixed(2)+'% · '+money(row.igst) : '—'}</td><td>{money(row.totalTax)}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}
