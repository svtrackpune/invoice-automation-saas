import type { PublicDocument } from './public-tokens';
import { canonicalAddress, createCanonicalDocumentViewModel } from '../../shared/document-view-model.ts';
import QRCode from 'qrcode';
import { createUnicodePdfDocument, pdfColor, pdfDocumentToBuffer, pdfFontName, pdfTextWidth, safePdfText } from './pdf-kit';

const W = 595.28, H = 841.89, M = 40, CW = W - M * 2, FOOTER_TOP = H - 68;
type RGB = readonly [number, number, number];
type Page = { usesLogo: boolean };
const C = {
  purple: [0.486, 0.227, 0.929] as RGB, indigo: [0.486, 0.227, 0.929] as RGB,
  navy: [0.059, 0.090, 0.165] as RGB, ink: [0.059, 0.090, 0.165] as RGB,
  muted: [0.392, 0.455, 0.545] as RGB, border: [0.886, 0.910, 0.941] as RGB,
  pale: [0.945, 0.957, 0.976] as RGB, rowBorder: [0.945, 0.957, 0.976] as RGB,
  lavender: [0.929, 0.914, 0.996] as RGB, white: [1, 1, 1] as RGB,
  green: [0.08, 0.40, 0.27] as RGB, amber: [0.918, 0.345, 0.047] as RGB,
  red: [0.68, 0.18, 0.20] as RGB,
};
const pdfText = (v: unknown) => safePdfText(v).replace(/[—–]/g, '-');
const money = (v: number, currency = 'INR') => {
  const code = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : 'INR';
  return code + ' ' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const dateLabel = (v: unknown) => {
  const s = pdfText(v), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : s || '-';
};
function wrap(v: unknown, max: number): string[] {
  const out: string[] = []; let line = '';
  for (const word of pdfText(v).split(/\s+/).filter(Boolean)) {
    const part = word.length > max ? word.slice(0, max) : word;
    if (!line) line = part;
    else if (line.length + part.length + 1 <= max) line += ' ' + part;
    else { out.push(line); line = part; }
  }
  if (line) out.push(line);
  return out.length ? out : ['-'];
}
function addressParts(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === 'string') return v.split(/\n|,/).map(ascii).filter(Boolean);
  if (typeof v !== 'object') return [pdfText(v)].filter(Boolean);
  const a = v as Record<string, unknown>;
  return [a.line1 || a.address_line1 || a.address_line_1 || a.street,
    a.line2 || a.address_line2 || a.address_line_2,
    [a.city || a.locality, a.state || a.country_subdivision_code, a.postal_code || a.pin || a.pincode].filter(Boolean).join(', '),
    a.country || a.country_code].map(ascii).filter(Boolean);
}
function stateLabel(code: string | null): string {
  const states: Record<string,string> = {
    '01':'Jammu & Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh','05':'Uttarakhand',
    '06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh','10':'Bihar','11':'Sikkim',
    '12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur','15':'Mizoram','16':'Tripura','17':'Meghalaya',
    '18':'Assam','19':'West Bengal','20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh',
    '24':'Gujarat','26':'Dadra and Nagar Haveli and Daman and Diu','27':'Maharashtra','28':'Andhra Pradesh (Old)',
    '29':'Karnataka','30':'Goa','31':'Lakshadweep','32':'Kerala','33':'Tamil Nadu','34':'Puducherry',
    '35':'Andaman and Nicobar Islands','36':'Telangana','37':'Andhra Pradesh','38':'Ladakh'
  };
  const c = pdfText(code);
  return c ? c + ' - ' + (states[c] || 'State / UT') : '';
}
function approxWidth(s: string, size: number, bold = false) {
  return Array.from(pdfText(s)).length * size * (bold ? 0.56 : 0.51);
}
class Canvas {
  doc: any;
  pages: Page[] = [{ usesLogo: false }];
  index = 0;
  logo: { bytes: Buffer; width: number; height: number } | null = null;

  constructor() {
    this.doc = createUnicodePdfDocument({ size: [W, H], margin: 0, bufferPages: true });
  }
  get p() { return this.pages[this.index]; }
  setLogo(logo: { bytes: Buffer; width: number; height: number } | null) { this.logo = logo; }
  activate() { this.doc.switchToPage(this.index); }
  switchToPage(index: number) { this.index = index; this.doc.switchToPage(index); }
  newPage() {
    this.doc.addPage({ size: [W, H], margin: 0 });
    this.index++;
    this.pages.push({ usesLogo: false });
  }
  text(x: number, top: number, value: unknown, size = 8.5, bold = false, color: RGB = C.ink, align: 'left'|'right'|'center' = 'left') {
    const s = pdfText(value);
    if (!s) return;
    const width = pdfTextWidth(this.doc, s, size, bold);
    const xx = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    this.activate();
    this.doc.font(pdfFontName(s, bold)).fontSize(size).fillColor(pdfColor(color)).text(s, xx, top, { lineBreak: false });
  }
  line(x1: number, t1: number, x2: number, t2: number, color: RGB = C.border, width = 0.6) {
    this.activate();
    this.doc.moveTo(x1, t1).lineTo(x2, t2).lineWidth(width).stroke(pdfColor(color));
  }
  rect(x: number, top: number, w: number, h: number, fill?: RGB, stroke?: RGB, lineWidth = 0.6) {
    this.activate();
    this.doc.rect(x, top, w, h);
    if (fill && stroke) this.doc.lineWidth(lineWidth).fillAndStroke(pdfColor(fill), pdfColor(stroke));
    else if (fill) this.doc.fill(pdfColor(fill));
    else if (stroke) this.doc.lineWidth(lineWidth).stroke(pdfColor(stroke));
  }
  polygon(points: Array<[number, number]>, fill: RGB) {
    if (points.length < 3) return;
    this.activate();
    this.doc.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) this.doc.lineTo(x, y);
    this.doc.closePath().fill(pdfColor(fill));
  }
  roundRect(x: number, top: number, w: number, h: number, radius = 8, fill?: RGB, stroke?: RGB, lineWidth = 0.6) {
    this.activate();
    this.doc.roundedRect(x, top, w, h, radius);
    if (fill && stroke) this.doc.lineWidth(lineWidth).fillAndStroke(pdfColor(fill), pdfColor(stroke));
    else if (fill) this.doc.fill(pdfColor(fill));
    else if (stroke) this.doc.lineWidth(lineWidth).stroke(pdfColor(stroke));
  }
  addLink(x: number, top: number, width: number, height: number, uri: string) {
    if (!uri || !/^(https?:|upi:)/i.test(uri)) return;
    this.activate();
    this.doc.link(x, top, width, height, uri);
  }
  imageLogo(x: number, top: number, w: number, h: number) {
    if (!this.logo) return;
    this.activate();
    this.doc.image(this.logo.bytes, x, top, { width: w, height: h });
    this.p.usesLogo = true;
  }
}
async function fetchLogo(storagePath: string | null): Promise<{ bytes: Buffer; width: number; height: number } | null> {
  if (!storagePath || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  try {
    const { getServerSupabase } = await import('@/lib/server/receipt-pdf');
    const url = getServerSupabase().storage.from('business-branding-public').getPublicUrl(storagePath).data.publicUrl;
    const res = await fetch(url, { signal: AbortSignal.timeout(2500), headers: { Accept: 'image/*' } });
    if (!res.ok || Number(res.headers.get('content-length') || 0) > 4 * 1024 * 1024) return null;
    const input = Buffer.from(await res.arrayBuffer());
    if (!input.length || input.length > 4 * 1024 * 1024) return null;
    const sharp = (await import('sharp')).default;
    const jpeg = await sharp(input).rotate().resize({ width: 420, height: 240, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 86 }).toBuffer();
    for (let i = 2; i < jpeg.length - 9;) {
      if (jpeg[i] !== 0xff) { i++; continue; }
      const marker = jpeg[i+1], len = jpeg.readUInt16BE(i+2);
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        return { bytes: jpeg, height: jpeg.readUInt16BE(i+5), width: jpeg.readUInt16BE(i+7) };
      }
      i += 2 + Math.max(2, len);
    }
  } catch { /* optional branding never blocks document delivery */ }
  return null;
}
function drawWrap(c: Canvas, x: number, top: number, value: unknown, max: number, size = 8, bold = false, color: RGB = C.ink, limit = 3) {
  const lines = wrap(value, max).slice(0, limit);
  lines.forEach((line, i) => c.text(x, top + i * (size + 3), line, size, bold, color));
  return lines.length * (size + 3);
}
const taxPresentation = (business?: PublicDocument['business']) => {
  const registration = String(business?.gstRegistrationType || '').trim().toUpperCase();
  const regime = String(business?.taxRegime || 'NONE').trim().toUpperCase();
  const country = String(business?.countryCode || 'IN').trim().toUpperCase();
  const taxNumber = String(business?.taxRegistrationNumber || '').trim().toUpperCase();
  const validRegistrationType = ['REGULAR', 'CASUAL', 'NON_RESIDENT', 'SEZ', 'COMPOSITION'].includes(registration);
  const validGstin = country === 'IN'
    ? /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(taxNumber)
    : Boolean(taxNumber);
  const gstRegistration = regime === 'GST' && validRegistrationType && validGstin;
  const composition = gstRegistration && registration === 'COMPOSITION';
  const otherTaxRegistration = country !== 'IN' && ['VAT', 'SALES_TAX', 'OTHER'].includes(regime)
    && Boolean(String(business?.taxId || business?.taxRegistrationNumber || '').trim());
  return { registration, regime, country, gstRegistration, composition,
    taxBreakdownAllowed: (gstRegistration && !composition) || otherTaxRegistration,
    title: composition ? 'BILL OF SUPPLY' : (gstRegistration || otherTaxRegistration) ? 'TAX INVOICE' : 'INVOICE',
    taxLabel: regime === 'GST' ? 'GSTIN' : 'Tax ID' };
};
const docTitle = (type: string, business?: PublicDocument['business']) => {
  if (type === 'invoice') return taxPresentation(business).title;
  if (type === 'cash_bill') return 'CASH BILL / POS RECEIPT';
  if (type === 'quotation') return 'QUOTATION';
  if (type === 'challan') return 'DELIVERY CHALLAN';
  if (type === 'purchase_order') return 'PURCHASE ORDER';
  if (type === 'credit_note') return 'CREDIT NOTE';
  if (type === 'receipt') return 'PAYMENT RECEIPT';
  return 'DOCUMENT';
};

type PublicPdfPalette = { primary: RGB; accent: RGB; accentSoft: RGB; pale: RGB; background: RGB; border: RGB; rowBorder: RGB; muted: RGB; ink: RGB };
const hexRgb = (value: string | null | undefined, fallback: string): RGB => {
  const raw = String(value || fallback).trim().replace(/^#/, '');
  const hex = /^[0-9a-f]{6}$/i.test(raw) ? raw : fallback.replace(/^#/, '');
  return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255) as unknown as RGB;
};
const tint = (color: RGB, ratio = 0.9): RGB => color.map(channel => channel * (1 - ratio) + ratio) as unknown as RGB;
function resolvePublicPdfPalette(theme?: PublicDocument['documentTheme']): PublicPdfPalette {
  const key = String(theme?.templateKey || 'modern').toLowerCase();
  const presets: Record<string, { primary: string; secondary: string; accent: string }> = {
    classic: { primary: '#7F1D1D', secondary: '#78716C', accent: '#991B1B' },
    minimal: { primary: '#111827', secondary: '#64748B', accent: '#2563EB' },
    modern: { primary: '#4338CA', secondary: '#64748B', accent: '#7C3AED' },
    premium: { primary: '#4C1D95', secondary: '#7C3AED', accent: '#A855F7' },
    professional: { primary: '#0F3B66', secondary: '#52677C', accent: '#145A8D' },
  };
  const preset = presets[key] || presets.modern;
  const primary = hexRgb(theme?.primaryColor, preset.primary);
  const accent = hexRgb(theme?.accentColor, preset.accent);
  const secondary = hexRgb(theme?.secondaryColor, preset.secondary);
  const background = hexRgb(theme?.backgroundColor, '#FFFFFF');
  return {
    primary, accent, accentSoft: tint(accent, 0.82), pale: tint(background, 0.93), background,
    border: tint(secondary, 0.65), rowBorder: tint(secondary, 0.87), muted: secondary,
    ink: hexRgb(theme?.textColor, '#172033'),
  };
}
const statusColor = (s: string): RGB => ['paid','accepted','delivered'].includes(s.toLowerCase()) ? C.green :
  ['overdue','void','cancelled'].includes(s.toLowerCase()) ? C.red : C.amber;

export async function buildPublicDocumentPdf(doc: PublicDocument): Promise<Buffer> {
  const tax = taxPresentation(doc.business);
  const taxBreakdownAllowed = tax.taxBreakdownAllowed;
  const palette = resolvePublicPdfPalette(doc.documentTheme);
  const canonical = createCanonicalDocumentViewModel(doc, { type: doc.type, upiId: doc.upiId, settlementDisplayMode: doc.settlementDisplayMode });
  const c = new Canvas(), right = W - M;
  const logo = await fetchLogo(canonical.business.logoUrl || null);
  c.setLogo(logo);

  const drawCornerVectors = () => {
    const key = String(doc.documentTheme?.templateKey || 'modern').toLowerCase();
    if (key === 'minimal') {
      c.polygon([[W - 128, 0], [W, 0], [W, 8], [W - 128, 8]], palette.pale);
      c.line(W - 44, 0, W - 44, 44, palette.accent, 1.2);
      c.line(W - 88, 22, W, 22, palette.primary, 1.1);
    } else if (key === 'classic') {
      c.polygon([[W - 124, 0], [W, 0], [W, 35], [W - 48, 35]], palette.accentSoft);
      c.polygon([[W - 76, 0], [W, 0], [W, 18]], palette.accent);
      c.line(W - 110, 0, W - 70, 35, palette.primary, 1.0);
    } else if (key === 'premium') {
      c.polygon([[W - 132, 0], [W, 0], [W, 48], [W - 54, 48]], palette.pale);
      c.polygon([[W - 93, 0], [W, 0], [W, 31]], palette.accent);
      c.polygon([[W - 111, 0], [W - 93, 0], [W, 31], [W - 18, 31]], palette.accentSoft);
    } else if (key === 'professional') {
      c.polygon([[W - 122, 0], [W, 0], [W, 42], [W - 122, 42]], palette.pale);
      c.polygon([[W - 48, 0], [W, 0], [W, 21], [W - 48, 21]], palette.accentSoft);
      c.line(W - 138, 10, W - 38, 10, palette.primary, 1.3);
    } else {
      c.polygon([[W - 134, 0], [W, 0], [W, 33], [W - 62, 33]], palette.accentSoft);
      c.polygon([[W - 82, 0], [W, 0], [W, 23]], palette.accent);
      c.line(W - 104, 0, W - 65, 33, palette.primary, 1.2);
    }
    c.polygon([[0, H], [24, H], [0, H - 24]], palette.accentSoft);
  };
  const header = (continued: boolean) => {
    c.rect(0, 0, W, H, palette.background);
    drawCornerVectors();
    if (doc.type === 'invoice' || doc.type === 'cash_bill') {
      if (logo && logoId) {
        const scale = Math.min(58 / logo.width, 45 / logo.height);
        c.imageLogo(M, 40, logo.width * scale, logo.height * scale);
      } else {
        c.roundRect(M, 40, 54, 43, 7, palette.pale, palette.border);
        c.text(M + 27, 54, wrap(doc.business.name, 2)[0].slice(0, 2).toUpperCase(), 12, true, palette.accent, 'center');
      }
      const bx = M + 70;
      const invoiceLabel = doc.type === 'cash_bill' ? 'CASH BILL / POS RECEIPT' : docTitle('invoice', doc.business);
      const invoiceBadgeWidth = Math.max(60, invoiceLabel.length * 4.7 + 12);
      c.roundRect(bx, 32, invoiceBadgeWidth, 16, 8, palette.accent);
      c.text(bx + invoiceBadgeWidth / 2, 35, invoiceLabel, 7.4, true, C.white, 'center');
      c.text(bx, 52, doc.number, 18, true, palette.primary);
      c.text(bx, 76, doc.business.name, 9.1, true, palette.primary);
      let leftY = 88;
      if (doc.business.legalName && doc.business.legalName.toLowerCase() !== doc.business.name.toLowerCase()) {
        drawWrap(c, bx, leftY, doc.business.legalName, 38, 7.0, false, palette.muted, 1);
        leftY += 10;
      }
      const address = addressParts(doc.business.address);
      if (address.length) {
        drawWrap(c, bx, leftY, address.join(', '), 42, 6.7, false, palette.muted, 2);
        leftY += Math.min(address.length, 2) * 8;
      }
      const contact = [doc.business.phone, doc.business.email].filter(Boolean).join(' | ');
      if (contact) c.text(bx, Math.min(124, leftY + 1), contact, 6.7, false, palette.muted);
      if (doc.business.taxRegistrationNumber) c.text(bx, 132, tax.taxLabel + ': ' + doc.business.taxRegistrationNumber, 6.6, false, palette.muted);

      const rx = right - 158;
      c.text(rx, 39, 'Invoice date: ' + dateLabel(doc.date), 7.5, false, palette.muted);
      c.text(rx, 54, 'Due date: ' + dateLabel(doc.dueDate), 7.5, false, palette.muted);
      const st = doc.status.replace(/_/g, ' ').toUpperCase();
      const badgeW = Math.min(110, Math.max(48, st.length * 5 + 18));
      c.roundRect(rx, 70, badgeW, 18, 9, palette.pale, palette.border);
      c.text(rx + badgeW / 2, 75, st, 7.2, true, palette.muted, 'center');
      c.line(M, 140, right, 140, palette.border, 0.8);
      return;
    }

    c.rect(M,32,4,92,C.indigo);
    if (logo && logoId) {
      const scale = Math.min(66 / logo.width, 48 / logo.height);
      c.imageLogo(M+12,38,logo.width*scale,logo.height*scale);
    } else {
      c.rect(M+12,40,46,42,palette.pale,palette.border);
      c.text(M+35,53,wrap(doc.business.name,2)[0].slice(0,2).toUpperCase(),13,true,C.indigo,'center');
    }
    const bx=M+70;
    c.text(bx,35,canonical.business.tradeName || canonical.business.legalName,13,true,palette.primary);
    let dy=53;
    addressParts(canonical.business.address).slice(0,2).forEach(v=>{drawWrap(c,bx,dy,v,40,7.5,false,palette.muted,1);dy+=10;});
    const contact=[canonical.business.phone,canonical.business.email].filter(Boolean).join(' | ');
    if(contact){drawWrap(c,bx,dy,contact,42,7.3,false,palette.muted,1);dy+=10;}
    if(canonical.business.gstin)c.text(bx,dy,tax.taxLabel+': '+canonical.business.gstin,7.5,true,palette.ink);
    if(canonical.business.pan)c.text(bx,dy+10,'PAN: '+canonical.business.pan,7.3,false,palette.muted);
    const rx=363,rw=right-rx;
    c.rect(rx,32,rw,92,palette.primary);
    c.text(rx+12,42,continued?docTitle(doc.type, doc.business)+' (CONTINUED)':docTitle(doc.type, doc.business),14,true,C.white);
    const st=doc.status.replace(/_/g,' ').toUpperCase(), badgeW=Math.min(84,Math.max(44,st.length*5+14));
    c.rect(right-badgeW-10,64,badgeW,15,statusColor(doc.status));
    c.text(right-badgeW/2-10,67,st,7,true,C.white,'center');
    c.text(rx+12,67,'DOCUMENT NO.',6.5,true,[0.78,0.82,0.91]);
    c.text(rx+12,77,doc.number,9.2,true,C.white);
    c.text(rx+12,93,'DATE  '+dateLabel(doc.date),7.2,false,C.white);
    if(doc.dueDate)c.text(rx+12,106,'DUE  '+dateLabel(doc.dueDate),7.2,false,C.white);
    else if(doc.validUntil)c.text(rx+12,106,'VALID UNTIL  '+dateLabel(doc.validUntil),7.2,false,C.white);
    c.line(M,135,right,135,palette.border,0.8);
  };
  const partyRows=(address:unknown,phone:string|null,email:string|null,taxId:string|null)=>
    [...addressParts(address).slice(0,2),phone||'',email||'',taxId?tax.taxLabel+': '+taxId:''].filter(Boolean);
  const drawParties=(top:number)=>{
    const gap=10,colW=(CW-gap)/2,boxH=100;
    const billingAddress=canonical.customer.billingAddress||canonicalAddress(doc.customer.address);
    const billingAddressRows=addressParts(billingAddress);
    const distinctShippingRows=addressParts(canonical.customer.shippingAddress);
    const billRows=[
      ...billingAddressRows,
      canonical.customer.phone||'',
      canonical.customer.email||'',
      canonical.customer.gstin?tax.taxLabel+': '+canonical.customer.gstin:''
    ].filter(Boolean);
    const shipRows=distinctShippingRows.length?distinctShippingRows:billingAddressRows.length?['Same as billing address']:['No shipping address provided'];
    const standardizedParties=['invoice','quotation','cash_bill','credit_note'].includes(doc.type);
    const list=[
      {x:M,label:standardizedParties?'BILL TO':'BILLED TO',name:canonical.customer.name,rows:billRows},
      {x:M+colW+gap,label:standardizedParties?'SHIP TO':'SHIPPED TO',name:canonical.customer.name,rows:shipRows}
    ];
    for(const p of list){
      c.rect(p.x,top,colW,boxH,C.white,palette.border,0.75); c.rect(p.x,top,colW,19,palette.pale);
      c.text(p.x+10,top+5,p.label,8,true,palette.accent); c.text(p.x+10,top+25,p.name,9.1,true,palette.primary);
      p.rows.slice(0,5).forEach((v,i)=>drawWrap(c,p.x+10,top+40+i*10,v,43,7.1,false,palette.muted,1));
    }
    const detailsTitle=doc.type==='invoice'||doc.type==='cash_bill'?'INVOICE DETAILS':doc.type==='quotation'?'QUOTATION DETAILS':doc.type==='purchase_order'?'PURCHASE ORDER DETAILS':doc.type==='credit_note'?'CREDIT NOTE DETAILS':'DOCUMENT DETAILS';
    c.text(M,top+113,detailsTitle,8,true,palette.primary);
    if(doc.type==='invoice'&&doc.templateName)c.text(M+100,top+113,'Template: '+doc.templateName,7,false,palette.muted);
    const state=stateLabel(doc.placeOfSupplyStateCode);
    if(state)c.text(right,top+113,'PLACE OF SUPPLY: '+state,7.3,true,palette.muted,'right');
    if(doc.type==='challan') {
      let detailsTop=top+128;
      if(doc.vehicleNumber)c.text(M,detailsTop,'Vehicle No: '+doc.vehicleNumber,7.2,false,palette.muted);
      if(doc.transporterName)c.text(M+205,detailsTop,'Transporter: '+doc.transporterName,7.2,false,palette.muted);
      if(doc.ewayBillNumber)c.text(M,detailsTop+12,'E-Way Bill: '+doc.ewayBillNumber,7.2,false,palette.muted);
      return top+(doc.ewayBillNumber?160:(doc.vehicleNumber||doc.transporterName?148:124));
    }
    return top+124;
  };
  const widths = doc.type === 'invoice' || doc.type === 'quotation' ? [25, 225, 50, 55, 70, 90] : [21,140,45,38,58,49,82,82];
  const labels = doc.type === 'invoice' || doc.type === 'quotation'
    ? ['#', 'ITEM / DESCRIPTION', 'QTY', 'UNIT', 'RATE', 'AMOUNT']
    : ['#','Item Description','HSN/SAC','Qty','Unit Rate','Discount','Taxable Amt','Total'];
  const tableHeader=(top:number)=>{
    if (doc.type === 'invoice' || doc.type === 'quotation') {
      c.rect(M, top, CW, 20, palette.accent);
      c.line(M, top + 20, right, top + 20, palette.rowBorder, 0.65);
      let x = M;
      widths.forEach((w, i) => {
        const align = i === 2 || i === 3 ? 'center' : i >= 4 ? 'right' : 'left';
        const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - 7 : x + 7;
        c.text(tx, top + 6, labels[i], 8, true, C.white, align);
        x += w;
      });
    } else {
      c.rect(M,top,CW,23,palette.primary);let x=M;
      widths.forEach((w,i)=>{const align=i>=3?'right':'left';c.text(align==='right'?x+w-5:x+5,top+7,labels[i],6.7,true,C.white,align);x+=w;});
    }
    return top + (doc.type === 'invoice' || doc.type === 'quotation' ? 20 : 23);
  };

  header(false);
  let y=drawParties(147)+4;
  y=tableHeader(y);
  const items=canonical.items;
  items.forEach((it,i)=>{
    const originalItem=doc.items[i];
    if (doc.type === 'invoice' || doc.type === 'quotation') {
      const nameLines = wrap(it.name || it.description || 'Item', 36).slice(0, 2);
      const detailLines = it.description && it.description !== it.name ? wrap(it.description, 39).slice(0, 2) : [];
      const rh = Math.max(32, nameLines.length * 10 + detailLines.length * 9 + (it.hsn ? 8 : 0) + 9);
      if (y + rh > FOOTER_TOP - 4) { c.newPage(); header(true); y = tableHeader(154); }
      c.line(M, y + rh, right, y + rh, palette.rowBorder, 0.5);
      const xs: number[] = []; let xx = M; for (const w of widths) { xs.push(xx); xx += w; }
      c.text(xs[0] + 5, y + 9, i + 1, 7.5, false, palette.muted);
      nameLines.forEach((line, j) => c.text(xs[1] + 7, y + 7 + j * 10, line, 8.5, true, palette.primary));
      detailLines.forEach((line, j) => c.text(xs[1] + 7, y + 7 + nameLines.length * 10 + j * 9, line, 7.5, false, palette.muted));
      if (it.hsn) c.text(xs[1] + 7, y + 7 + nameLines.length * 10 + detailLines.length * 9, 'HSN / SAC: ' + it.hsn, 6.5, false, palette.muted);
      c.text(xs[2] + widths[2] / 2, y + 9, pdfText(it.quantity), 7.7, false, palette.ink, 'center');
      c.text(xs[3] + widths[3] / 2, y + 9, pdfText(originalItem?.unit || it.unit || 'pcs').toUpperCase(), 7.0, true, palette.muted, 'center');
      c.text(xs[4] + widths[4] - 6, y + 9, money(it.unitPrice, canonical.document.currency), 7.5, false, palette.ink, 'right');
      c.text(xs[5] + widths[5] - 6, y + 9, money(it.amount, canonical.document.currency), 7.8, true, palette.primary, 'right');
      y += rh;
    } else {
      const desc=wrap(it.name||it.description,31).slice(0,3), rh=Math.max(25,desc.length*9+10);
      if(y+rh>FOOTER_TOP-4){c.newPage();header(true);y=tableHeader(154);}
      if(i%2===1)c.rect(M,y,CW,rh,palette.pale);
      c.line(M,y+rh,right,y+rh,palette.border,0.45);
      const xs:number[]=[];let xx=M;for(const w of widths){xs.push(xx);xx+=w;}
      c.text(xs[0]+5,y+8,i+1,7,false,palette.muted);
      desc.forEach((v,j)=>c.text(xs[1]+5,y+6+j*9,v,7.2,j===0,palette.ink));
      c.text(xs[2]+4,y+8,it.hsn||'-',6.6,false,palette.muted);
      c.text(xs[3]+widths[3]-5,y+8,pdfText(it.quantity)+(originalItem?.unit?' '+pdfText(originalItem.unit).slice(0,4):''),6.9,false,palette.ink,'right');
      c.text(xs[4]+widths[4]-5,y+8,money(it.unitPrice,canonical.document.currency),6.5,false,palette.ink,'right');
      c.text(xs[5]+widths[5]-5,y+8,it.discount?money(it.discount,canonical.document.currency):'-',6.5,false,palette.ink,'right');
      const taxable=Math.max(0,it.quantity*it.unitPrice-it.discount);
      c.text(xs[6]+widths[6]-5,y+8,money(taxable,canonical.document.currency),6.5,false,palette.ink,'right');
      c.text(xs[7]+widths[7]-5,y+8,money(it.amount,canonical.document.currency),6.5,true,palette.ink,'right');
      y+=rh;
    }
  });
  let invoiceSettlementTop: number | null = null;
  let invoiceSignatureEndY = 0;
  if (doc.type === 'invoice') {
    if (y + 330 > FOOTER_TOP - 4) { c.newPage(); header(true); y = 154; }
    y += 10;
    const summaryTop = y;
    const totalW = 205, totalX = right - totalW;
    const rows: Array<[string, number, 'normal'|'total'|'balance']> = [
      ['Subtotal', canonical.financials.subtotal, 'normal']
    ];
    if (canonical.financials.totalDiscount !== 0) rows.push(['Discount', -Math.abs(canonical.financials.totalDiscount), 'normal']);
    if (taxBreakdownAllowed && tax.regime === 'GST' && canonical.financials.taxBreakdown.length) {
      canonical.financials.taxBreakdown.forEach(line => rows.push([
        line.rate > 0 ? line.name + ' (' + line.rate + '%)' : line.name,
        line.amount, 'normal'
      ]));
    } else if (taxBreakdownAllowed && tax.regime !== 'GST' && doc.taxTotal !== 0) {
      rows.push(['Tax', doc.taxTotal, 'normal']);
    } else if (taxBreakdownAllowed && tax.regime === 'GST' && doc.taxTotal !== 0) {
      rows.push(['GST', doc.taxTotal, 'normal']);
    }
    rows.push(['Net Payable', canonical.financials.grandTotal, 'total']);
    if (canonical.financials.amountPaid > 0) rows.push(['Amount paid', canonical.financials.amountPaid, 'normal']);
    rows.push(['Balance due', canonical.financials.balanceDue, 'balance']);

    c.line(totalX, summaryTop, right, summaryTop, palette.border, 0.7);
    let totalY = summaryTop + 5;
    for (const [label, value, kind] of rows) {
      const rowH = kind === 'normal' ? 15 : 19;
      if (kind === 'total') c.roundRect(totalX, totalY, totalW, rowH, 4, palette.pale);
      if (kind === 'balance') c.roundRect(totalX, totalY, totalW, rowH, 4, [1, 0.97, 0.94] as RGB);
      const emphasized = kind !== 'normal' || label === 'Subtotal' || /^(IGST|CGST|SGST|Tax|GST)(\b|\s|\/)/i.test(label);
      const col = emphasized ? C.amber : palette.primary;
      c.text(totalX + 8, totalY + 4, label, emphasized ? 8.1 : 7.6, emphasized, col);
      c.text(right - 8, totalY + 4, (value < 0 ? '-' : '') + money(Math.abs(value), doc.currencyCode),
        emphasized ? 8.1 : 7.6, emphasized, col, 'right');
      totalY += rowH + 1;
    }

    const amountWords = wrap(canonical.financials.amountInWords, 36).slice(0, 3);
    const wordsTop = totalY + 7;
    const wordsHeight = Math.max(32, 17 + amountWords.length * 9);
    c.roundRect(totalX, wordsTop, totalW, wordsHeight, 5, palette.pale, palette.border, 0.6);
    c.text(totalX + 8, wordsTop + 5, 'AMOUNT IN WORDS:', 7.2, true, palette.accent);
    amountWords.forEach((line, index) => c.text(totalX + 8, wordsTop + 16 + index * 8, line, 7.2, false, palette.primary));

    const sigX = right - 175;
    const sigY = wordsTop + wordsHeight + 10;
    c.text(right, sigY, 'For ' + (doc.business.legalName || doc.business.name), 8, false, palette.muted, 'right');
    c.line(sigX + 45, sigY + 38, sigX + 175, sigY + 38, palette.border, 0.7);
    c.text(right, sigY + 42, 'Authorized Signatory', 7.5, true, palette.primary, 'right');
    invoiceSignatureEndY = sigY + 53;
    invoiceSettlementTop = summaryTop;
    y = Math.max(invoiceSettlementTop, invoiceSignatureEndY) + 8;
  } else {
  if(y+190>FOOTER_TOP-4){c.newPage();header(true);y=154;}else y+=12;

  const totalX=342,totalW=right-totalX,wordX=M;
  c.text(wordX,y+2,'AMOUNT IN WORDS:',7.2,true,palette.accent);
  drawWrap(c,wordX,y+16,canonical.financials.amountInWords,42,8.1,true,palette.primary,3);
  c.rect(totalX,y-2,totalW,18,palette.pale,palette.border);
  c.text(totalX+8,y+3,'FINANCIAL SUMMARY',7.3,true,C.indigo);y+=20;
  const summary:Array<[string,number,boolean]> = doc.type === 'challan'
    ? [['Declared Value',canonical.financials.grandTotal,true]]
    : [
      ['Subtotal',canonical.financials.subtotal,false],
      ['Trade Discount',-Math.abs(canonical.financials.totalDiscount),false],
      ...(doc.type === 'quotation' && !taxBreakdownAllowed ? [] : [['Taxable Value',Math.max(0,canonical.financials.subtotal-canonical.financials.totalDiscount),false] as [string,number,boolean]])
    ];
  if(doc.type !== 'challan') {
    if(taxBreakdownAllowed && tax.regime === 'GST' && canonical.financials.taxBreakdown.length) {
      canonical.financials.taxBreakdown.forEach(line => summary.push([
        line.rate>0 ? line.name+' ('+line.rate+'%)' : line.name,
        line.amount,
        false
      ]));
    } else if (taxBreakdownAllowed && tax.regime !== 'GST' && doc.taxTotal !== 0) {
      summary.push(['Tax',doc.taxTotal,false]);
    }
    summary.push(['Round Off',canonical.financials.roundOff,false],['Grand Total',canonical.financials.grandTotal,true]);
  }
  for(const [label,value,bold] of summary){
    if(y+15>FOOTER_TOP-4){c.newPage();header(true);y=154;}
    if(bold)c.rect(totalX,y-1,totalW,17,label==='Grand Total'?palette.primary:palette.pale);
    const color=bold&&label==='Grand Total'?C.white:palette.ink;
    c.text(totalX+7,y+2,label,label==='Grand Total'?8.1:7.5,bold,color);
    c.text(right-7,y+2,(value<0?'-':'')+money(Math.abs(value),doc.currencyCode),label==='Grand Total'?8.2:7.4,bold,color,'right');
    y+=16;
  }
  if (doc.type === 'quotation') {
    if (y + 62 > FOOTER_TOP - 4) { c.newPage(); header(true); y = 154; }
    const sigX = right - 175, sigY = y + 8;
    c.text(right, sigY, 'For ' + (doc.business.legalName || doc.business.name), 8, false, palette.muted, 'right');
    c.line(sigX + 45, sigY + 38, sigX + 175, sigY + 38, palette.border, 0.7);
    c.text(right, sigY + 42, 'Authorized Signatory', 7.5, true, palette.primary, 'right');
    y = sigY + 53;
  }
  }
  if(doc.type==='challan'){
    if(y+38>FOOTER_TOP-4){c.newPage();header(true);y=154;}
    c.rect(M,y,CW,30,palette.pale,palette.border);
    c.text(M+8,y+5,'SUPPLY ON APPROVAL / JOB WORK / EXHIBITION / TRANSPORTATION ONLY',7.1,true,palette.primary);
    c.text(M+8,y+17,'NOT FOR SALE / NOT A TAX INVOICE',8,true,C.red);
    y+=38;
  }
  y += 5;
  const qrCandidate = canonical.financials.upiQrString
    || (doc.type === 'invoice' && String(doc.currencyCode).toUpperCase() === 'INR' && doc.balanceDue > 0
      && doc.paymentQrPayload?.startsWith('upi://pay?') ? doc.paymentQrPayload : null);
  const qrData = qrCandidate?.startsWith('upi://pay?') ? qrCandidate : null;
  const showQrSettlement = Boolean(qrData && (canonical.settlementDisplayMode === 'upi_qr' || canonical.settlementDisplayMode === 'both'));
  const showBankSettlement = Boolean(doc.bankDetails && (canonical.settlementDisplayMode === 'bank_transfer' || canonical.settlementDisplayMode === 'both'));

  if (doc.type === 'invoice') {
    let renderedPaymentCardHeight = 0;
    if (showBankSettlement || showQrSettlement) {
      const bothSettlement = showBankSettlement && showQrSettlement && canonical.settlementDisplayMode === 'both';
      const cardX = M, cardW = 200;
      const cardH = bothSettlement ? 184 : showQrSettlement ? 128 : 88;
      let cardY = invoiceSettlementTop ?? y;
      if (cardY + cardH > FOOTER_TOP - 4) { c.newPage(); header(true); cardY = 154; }
      c.roundRect(cardX, cardY, cardW, cardH, 6, C.white, palette.border, 0.75);
      c.text(cardX + cardW / 2, cardY + 8, bothSettlement ? 'PAYMENT SETTLEMENT' : showQrSettlement ? 'SCAN & PAY VIA UPI' : 'BANK DETAILS', 8, true, palette.accent, 'center');

      if (showBankSettlement && doc.bankDetails) {
        const b = doc.bankDetails;
        const bankTop = cardY + 23;
        c.text(cardX + 9, bankTop, b.institutionName || b.name || 'Bank', 7.5, true, palette.primary);
        c.text(cardX + 9, bankTop + 12, 'Account Holder: ' + (b.accountHolderName || doc.business.name), 7.1, false, palette.muted);
        c.text(cardX + 9, bankTop + 23, 'A/C No: ' + (b.accountNumber || (b.accountLast4 ? 'XXXX ' + b.accountLast4 : '-')), 7.1, false, palette.muted);
        c.text(cardX + 9, bankTop + 34, 'IFSC: ' + (b.ifscCode || '-'), 7.1, false, palette.muted);
        c.text(cardX + 9, bankTop + 45, 'Branch: ' + (b.branchName || '-'), 7.1, false, palette.muted);
      }

      if (showQrSettlement && qrData) {
        const buttonW = 100, buttonH = 16;
        const buttonX = cardX + (cardW - buttonW) / 2;
        const buttonY = cardY + (bothSettlement ? 79 : 22);
        c.roundRect(buttonX, buttonY, buttonW, buttonH, 8, palette.accent);
        c.text(buttonX + buttonW / 2, buttonY + 4, 'Pay Now via UPI', 6.8, true, C.white, 'center');
        c.addLink(buttonX, buttonY, buttonW, buttonH, doc.paymentLink || qrData);
        const qrSize = 65;
        const qrX = cardX + (cardW - qrSize) / 2;
        const qrY = cardY + (bothSettlement ? 99 : 42);
        c.rect(qrX, qrY, qrSize, qrSize, C.white, palette.border, 0.4);
        const q = QRCode.create(qrData, { errorCorrectionLevel: 'M' }), n = q.modules.size;
        const area = 57, quiet = 4, cell = area / n, qx = qrX + quiet, qy = qrY + quiet;
        for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
          if (q.modules.data[row * n + col]) c.rect(qx + col * cell, qy + row * cell, cell + 0.025, cell + 0.025, palette.primary);
        }
        c.text(cardX + cardW / 2, qrY + qrSize + 3, 'Scan to pay the invoice amount.', 6.0, false, palette.muted, 'center');
      }
      renderedPaymentCardHeight = cardH;
    }
    let infoY = (invoiceSettlementTop ?? y) + renderedPaymentCardHeight + (renderedPaymentCardHeight ? 12 : 0);
    const drawInvoiceInfoSection = (label: string, lines: string[]) => {
      if (infoY + 13 > FOOTER_TOP - 4) { c.newPage(); header(true); infoY = 154; }
      c.text(M, infoY, label, 8, true, palette.accent); infoY += 13;
      for (const value of lines) {
        if (infoY + 10 > FOOTER_TOP - 4) {
          c.newPage(); header(true); infoY = 154;
          c.text(M, infoY, label + ' (CONTINUED)', 8, true, palette.accent); infoY += 13;
        }
        c.text(M, infoY, value, 7.3, false, palette.muted); infoY += 10;
      }
      infoY += 5;
    };
    // Never silently truncate saved terms or notes. Long text continues on a
    // fresh page above the statutory footer instead of disappearing below it.
    drawInvoiceInfoSection('TERMS & CONDITIONS', doc.terms ? wrap(doc.terms, 47) : ['—']);
    drawInvoiceInfoSection('NOTES', doc.notes ? wrap(doc.notes, 47) : ['—']);
    y = Math.max(infoY + 8, invoiceSignatureEndY + 8);
  } else {
    if (showBankSettlement || showQrSettlement) {
      const sectionH=showQrSettlement?100:76;
      if(y+sectionH>FOOTER_TOP-4){c.newPage();header(true);y=154;}
    c.line(M,y,right,y,palette.border,0.75);y+=8;c.text(M,y,'PAYMENT / SETTLEMENT DETAILS',8,true,palette.primary);y+=15;
    if(showBankSettlement&&doc.bankDetails){
      const b=doc.bankDetails;
      c.text(M,y,b.institutionName||b.name||'Bank',8.1,true,palette.ink);
      c.text(M,y+13,'A/C Holder: '+(b.accountHolderName||doc.business.name),7.3,false,palette.muted);
      c.text(M,y+25,'A/C No: '+(b.accountNumber||(b.accountLast4?'XXXX '+b.accountLast4:'-')),7.3,false,palette.muted);
      c.text(M,y+37,'IFSC: '+(b.ifscCode||'-')+'   Branch: '+(b.branchName||'-'),7.3,false,palette.muted);
    }
    if(showQrSettlement&&qrData){
      const q=QRCode.create(qrData,{errorCorrectionLevel:'M'}), n=q.modules.size, area=72, cell=area/n, qx=right-area, qy=y-2;
      c.rect(qx-4,qy-4,area+8,area+8,C.white,palette.border);
      for(let row=0;row<n;row++)for(let col=0;col<n;col++)if(q.modules.data[row*n+col])c.rect(qx+col*cell,qy+row*cell,cell+0.04,cell+0.04,palette.ink);
      c.text(qx+area/2,qy+area+5,'SCAN TO PAY',6.5,true,palette.muted,'center');
    }
    y+=showQrSettlement?88:45;
  }

  }
  if (doc.type !== 'invoice') {
    const legalTerms = doc.terms || null;
    if (doc.notes || legalTerms) {
      const lines = [
        ...(doc.notes ? wrap('Notes: ' + doc.notes, 100) : []),
        ...(legalTerms ? wrap('Terms: ' + legalTerms, 100) : []),
      ];
      if (y + 22 > FOOTER_TOP - 4) { c.newPage(); header(true); y = 154; }
      c.line(M, y, right, y); y += 8;
      c.text(M, y, 'TERMS & CONDITIONS', 7.8, true, palette.primary); y += 13;
      for (const value of lines) {
        if (y + 10 > FOOTER_TOP - 4) {
          c.newPage(); header(true); y = 154;
          c.line(M, y, right, y); y += 8;
          c.text(M, y, 'TERMS & CONDITIONS (CONTINUED)', 7.8, true, palette.primary); y += 13;
        }
        c.text(M, y, value, 7, false, palette.muted); y += 10;
      }
    }
  }
  const pageCount = c.pages.length;
  const footerText = doc.type === 'invoice' || doc.type === 'cash_bill'
    ? 'This is a computer-generated ' + (doc.type === 'cash_bill' ? 'cash bill' : 'invoice') + ' and does not require signature.'
    : doc.type === 'quotation'
      ? 'This is a computer-generated quotation and does not require signature.'
      : 'Generated via Moneymatters FinOps | Join Moneymatters for free at mm.nilanga.in';
  const poweredText = 'Powered by Moneymatters FinOps | mm.nilanga.in';
  for (let i = 0; i < pageCount; i++) {
    c.switchToPage(i);
    c.line(M, 780, right, 780, palette.accent, 1.5);
    c.line(M, 783, right, 783, palette.border, 0.5);
    c.text(W / 2, 792, footerText, 7.5, false, palette.muted, 'center');
    c.text(W / 2, 803, poweredText, 7, false, palette.muted, 'center');
  }
  return await pdfDocumentToBuffer(c.doc);
}
