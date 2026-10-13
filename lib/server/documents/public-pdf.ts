import type { PublicDocument } from './public-tokens';
import { canonicalAddress, createCanonicalDocumentViewModel } from '../../shared/document-view-model.ts';
import QRCode from 'qrcode';

const W = 595.28, H = 841.89, M = 40, CW = W - M * 2, FOOTER_TOP = H - 68;
type RGB = readonly [number, number, number];
type PdfLink = { x: number; top: number; width: number; height: number; uri: string };
type Page = { commands: string[]; usesLogo: boolean; links: PdfLink[] };
const C = {
  purple: [0.486, 0.227, 0.929] as RGB, indigo: [0.486, 0.227, 0.929] as RGB,
  navy: [0.059, 0.090, 0.165] as RGB, ink: [0.059, 0.090, 0.165] as RGB,
  muted: [0.392, 0.455, 0.545] as RGB, border: [0.886, 0.910, 0.941] as RGB,
  pale: [0.945, 0.957, 0.976] as RGB, rowBorder: [0.945, 0.957, 0.976] as RGB,
  lavender: [0.929, 0.914, 0.996] as RGB, white: [1, 1, 1] as RGB,
  green: [0.08, 0.40, 0.27] as RGB, amber: [0.918, 0.345, 0.047] as RGB,
  red: [0.68, 0.18, 0.20] as RGB,
};
const ascii = (v: unknown) => String(v ?? '').replace(/₹/g, 'INR ').replace(/[—–]/g, '-')
  .replace(/[•·]/g, ' ').normalize('NFKD').replace(/[^\x20-\x7E]/g, '')
  .replace(/[\r\n\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (v: unknown) => ascii(v).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const rgb = (c: RGB) => c.map(v => v.toFixed(3)).join(' ');
const money = (v: number, currency = 'INR') => {
  const code = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : 'INR';
  return code + ' ' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const dateLabel = (v: unknown) => {
  const s = ascii(v), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : s || '-';
};
function wrap(v: unknown, max: number): string[] {
  const out: string[] = []; let line = '';
  for (const word of ascii(v).split(/\s+/).filter(Boolean)) {
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
  if (typeof v !== 'object') return [ascii(v)].filter(Boolean);
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
  const c = ascii(code);
  return c ? c + ' - ' + (states[c] || 'State / UT') : '';
}
function approxWidth(s: string, size: number, bold = false) { return ascii(s).length * size * (bold ? 0.56 : 0.51); }
class Canvas {
  pages: Page[] = [{ commands: [], usesLogo: false, links: [] }];
  index = 0;
  get p() { return this.pages[this.index]; }
  get cmd() { return this.p.commands; }
  newPage() { this.pages.push({ commands: [], usesLogo: false, links: [] }); this.index++; }
  text(x: number, top: number, value: unknown, size = 8.5, bold = false, color: RGB = C.ink, align: 'left'|'right'|'center' = 'left') {
    const s = ascii(value); if (!s) return;
    const width = approxWidth(s, size, bold);
    const xx = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    this.cmd.push(rgb(color) + ' rg BT /' + (bold ? 'F2' : 'F1') + ' ' + size.toFixed(2) + ' Tf 1 0 0 1 ' +
      xx.toFixed(2) + ' ' + (H - top - size).toFixed(2) + ' Tm (' + esc(s) + ') Tj ET');
  }
  line(x1: number, t1: number, x2: number, t2: number, color: RGB = C.border, width = 0.6) {
    this.cmd.push(rgb(color) + ' RG ' + width.toFixed(2) + ' w ' + x1.toFixed(2) + ' ' + (H-t1).toFixed(2) +
      ' m ' + x2.toFixed(2) + ' ' + (H-t2).toFixed(2) + ' l S');
  }
  rect(x: number, top: number, w: number, h: number, fill?: RGB, stroke?: RGB, lineWidth = 0.6) {
    const ops = ['q'];
    if (fill) ops.push(rgb(fill) + ' rg');
    if (stroke) ops.push(rgb(stroke) + ' RG ' + lineWidth.toFixed(2) + ' w');
    ops.push(x.toFixed(2) + ' ' + (H-top-h).toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re');
    ops.push(fill && stroke ? 'B' : fill ? 'f' : 'S', 'Q');
    this.cmd.push(ops.join(' '));
  }
  polygon(points: Array<[number, number]>, fill: RGB) {
    if (points.length < 3) return;
    const first = points[0];
    const ops = ['q', rgb(fill) + ' rg', first[0].toFixed(2) + ' ' + (H - first[1]).toFixed(2) + ' m'];
    for (const [x, top] of points.slice(1)) ops.push(x.toFixed(2) + ' ' + (H - top).toFixed(2) + ' l');
    ops.push('h f Q');
    this.cmd.push(ops.join(' '));
  }
  roundRect(x: number, top: number, w: number, h: number, radius = 8, fill?: RGB, stroke?: RGB, lineWidth = 0.6) {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    const k = 0.5522847498 * r;
    const y = H - top, b = H - top - h;
    const ops = ['q'];
    if (fill) ops.push(rgb(fill) + ' rg');
    if (stroke) ops.push(rgb(stroke) + ' RG ' + lineWidth.toFixed(2) + ' w');
    ops.push((x + r).toFixed(2) + ' ' + y.toFixed(2) + ' m');
    ops.push((x + w - r).toFixed(2) + ' ' + y.toFixed(2) + ' l');
    ops.push((x + w - r + k).toFixed(2) + ' ' + y.toFixed(2) + ' ' + (x + w).toFixed(2) + ' ' + (y - r + k).toFixed(2) + ' ' + (x + w).toFixed(2) + ' ' + (y - r).toFixed(2) + ' c');
    ops.push((x + w).toFixed(2) + ' ' + (b + r).toFixed(2) + ' l');
    ops.push((x + w).toFixed(2) + ' ' + (b + r - k).toFixed(2) + ' ' + (x + w - r + k).toFixed(2) + ' ' + b.toFixed(2) + ' ' + (x + w - r).toFixed(2) + ' ' + b.toFixed(2) + ' c');
    ops.push((x + r).toFixed(2) + ' ' + b.toFixed(2) + ' l');
    ops.push((x + r - k).toFixed(2) + ' ' + b.toFixed(2) + ' ' + x.toFixed(2) + ' ' + (b + r - k).toFixed(2) + ' ' + x.toFixed(2) + ' ' + (b + r).toFixed(2) + ' c');
    ops.push(x.toFixed(2) + ' ' + (y - r).toFixed(2) + ' l');
    ops.push(x.toFixed(2) + ' ' + (y - r + k).toFixed(2) + ' ' + (x + r - k).toFixed(2) + ' ' + y.toFixed(2) + ' ' + (x + r).toFixed(2) + ' ' + y.toFixed(2) + ' c');
    ops.push(fill && stroke ? 'B' : fill ? 'f' : 'S', 'Q');
    this.cmd.push(ops.join(' '));
  }
  addLink(x: number, top: number, width: number, height: number, uri: string) {
    if (!uri || !/^(https?:|upi:)/i.test(uri)) return;
    this.p.links.push({ x, top, width, height, uri });
  }
  imageLogo(x: number, top: number, w: number, h: number) {
    this.p.usesLogo = true;
    this.cmd.push('q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + x.toFixed(2) + ' ' +
      (H-top-h).toFixed(2) + ' cm /Logo Do Q');
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
const docTitle = (type: string) => type === 'invoice' ? 'TAX INVOICE' : type === 'quotation' ? 'ESTIMATE / QUOTATION' : type === 'challan' ? 'DELIVERY CHALLAN' : 'PAYMENT RECEIPT';
const statusColor = (s: string): RGB => ['paid','accepted','delivered'].includes(s.toLowerCase()) ? C.green :
  ['overdue','void','cancelled'].includes(s.toLowerCase()) ? C.red : C.amber;

export async function buildPublicDocumentPdf(doc: PublicDocument): Promise<Buffer> {
  const canonical = createCanonicalDocumentViewModel(doc, { type: doc.type, upiId: doc.upiId, settlementDisplayMode: doc.settlementDisplayMode });
  const c = new Canvas(), right = W - M;
  const objects: Array<Buffer|string> = [];
  const add = (v: Buffer|string) => { objects.push(v); return objects.length; };
  const catalogId = add(''), pagesId = add('');
  const font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const logo = await fetchLogo(canonical.business.logoUrl || null);
  const logoId = logo ? add('') : null;

  const header = (continued: boolean) => {
    if (doc.type === 'invoice') {
      // Crisp brand slants in the upper-right corner, built entirely from PDF vector paths.
      c.polygon([[W - 104, 0], [W, 0], [W, 27], [W - 61, 27]], C.purple);
      c.polygon([[W - 142, 0], [W - 104, 0], [W - 61, 27], [W - 99, 27]], C.lavender);
      if (logo && logoId) {
        const scale = Math.min(58 / logo.width, 45 / logo.height);
        c.imageLogo(M, 40, logo.width * scale, logo.height * scale);
      } else {
        c.roundRect(M, 40, 54, 43, 7, C.pale, C.border);
        c.text(M + 27, 54, wrap(doc.business.name, 2)[0].slice(0, 2).toUpperCase(), 12, true, C.purple, 'center');
      }
      const bx = M + 70;
      c.roundRect(bx, 32, 60, 16, 8, C.purple);
      c.text(bx + 30, 35, 'INVOICE', 7.4, true, C.white, 'center');
      c.text(bx, 52, doc.number, 18, true, C.navy);
      c.text(bx, 76, doc.business.name, 9.1, true, C.navy);
      let leftY = 88;
      if (doc.business.legalName && doc.business.legalName.toLowerCase() !== doc.business.name.toLowerCase()) {
        drawWrap(c, bx, leftY, doc.business.legalName, 38, 7.0, false, C.muted, 1);
        leftY += 10;
      }
      const address = addressParts(doc.business.address);
      if (address.length) {
        drawWrap(c, bx, leftY, address.join(', '), 42, 6.7, false, C.muted, 2);
        leftY += Math.min(address.length, 2) * 8;
      }
      const contact = [doc.business.phone, doc.business.email].filter(Boolean).join(' | ');
      if (contact) c.text(bx, Math.min(124, leftY + 1), contact, 6.7, false, C.muted);
      if (doc.business.taxRegistrationNumber) c.text(bx, 132, 'GSTIN: ' + doc.business.taxRegistrationNumber, 6.6, false, C.muted);

      const rx = right - 158;
      c.text(rx, 39, 'Invoice date: ' + dateLabel(doc.date), 7.5, false, C.muted);
      c.text(rx, 54, 'Due date: ' + dateLabel(doc.dueDate), 7.5, false, C.muted);
      const st = doc.status.replace(/_/g, ' ').toUpperCase();
      const badgeW = Math.min(110, Math.max(48, st.length * 5 + 18));
      c.roundRect(rx, 70, badgeW, 18, 9, C.pale, C.border);
      c.text(rx + badgeW / 2, 75, st, 7.2, true, C.muted, 'center');
      c.line(M, 140, right, 140, C.border, 0.8);
      return;
    }

    c.rect(M,32,4,92,C.indigo);
    if (logo && logoId) {
      const scale = Math.min(66 / logo.width, 48 / logo.height);
      c.imageLogo(M+12,38,logo.width*scale,logo.height*scale);
    } else {
      c.rect(M+12,40,46,42,C.pale,C.border);
      c.text(M+35,53,wrap(doc.business.name,2)[0].slice(0,2).toUpperCase(),13,true,C.indigo,'center');
    }
    const bx=M+70;
    c.text(bx,35,canonical.business.tradeName || canonical.business.legalName,13,true,C.navy);
    let dy=53;
    addressParts(canonical.business.address).slice(0,2).forEach(v=>{drawWrap(c,bx,dy,v,40,7.5,false,C.muted,1);dy+=10;});
    const contact=[canonical.business.phone,canonical.business.email].filter(Boolean).join(' | ');
    if(contact){drawWrap(c,bx,dy,contact,42,7.3,false,C.muted,1);dy+=10;}
    if(canonical.business.gstin)c.text(bx,dy,'GSTIN: '+canonical.business.gstin,7.5,true,C.ink);
    if(canonical.business.pan)c.text(bx,dy+10,'PAN: '+canonical.business.pan,7.3,false,C.muted);
    const rx=363,rw=right-rx;
    c.rect(rx,32,rw,92,C.navy);
    c.text(rx+12,42,continued?docTitle(doc.type)+' (CONTINUED)':docTitle(doc.type),14,true,C.white);
    const st=doc.status.replace(/_/g,' ').toUpperCase(), badgeW=Math.min(84,Math.max(44,st.length*5+14));
    c.rect(right-badgeW-10,64,badgeW,15,statusColor(doc.status));
    c.text(right-badgeW/2-10,67,st,7,true,C.white,'center');
    c.text(rx+12,67,'DOCUMENT NO.',6.5,true,[0.78,0.82,0.91]);
    c.text(rx+12,77,doc.number,9.2,true,C.white);
    c.text(rx+12,93,'DATE  '+dateLabel(doc.date),7.2,false,C.white);
    if(doc.dueDate)c.text(rx+12,106,'DUE  '+dateLabel(doc.dueDate),7.2,false,C.white);
    else if(doc.validUntil)c.text(rx+12,106,'VALID UNTIL  '+dateLabel(doc.validUntil),7.2,false,C.white);
    c.line(M,135,right,135,C.border,0.8);
  };
  const partyRows=(address:unknown,phone:string|null,email:string|null,taxId:string|null)=>
    [...addressParts(address).slice(0,2),phone||'',email||'',taxId?'GSTIN: '+taxId:''].filter(Boolean);
  const drawParties=(top:number)=>{
    const gap=10,colW=(CW-gap)/2,boxH=100;
    const billingAddress=canonical.customer.billingAddress||canonicalAddress(doc.customer.address);
    const billingAddressRows=addressParts(billingAddress);
    const distinctShippingRows=addressParts(canonical.customer.shippingAddress);
    const billRows=[
      ...billingAddressRows,
      canonical.customer.phone||'',
      canonical.customer.email||'',
      canonical.customer.gstin?'GSTIN: '+canonical.customer.gstin:''
    ].filter(Boolean);
    const shipRows=distinctShippingRows.length?distinctShippingRows:billingAddressRows.length?['Same as billing address']:['No shipping address provided'];
    const standardizedParties=doc.type==='invoice'||doc.type==='quotation';
    const list=[
      {x:M,label:standardizedParties?'BILL TO':'BILLED TO',name:canonical.customer.name,rows:billRows},
      {x:M+colW+gap,label:standardizedParties?'SHIP TO':'SHIPPED TO',name:canonical.customer.name,rows:shipRows}
    ];
    for(const p of list){
      c.rect(p.x,top,colW,boxH,C.white,C.border,0.75); c.rect(p.x,top,colW,19,C.pale);
      c.text(p.x+10,top+5,p.label,8,true,C.purple); c.text(p.x+10,top+25,p.name,9.1,true,C.navy);
      p.rows.slice(0,5).forEach((v,i)=>drawWrap(c,p.x+10,top+40+i*10,v,43,7.1,false,C.muted,1));
    }
    const detailsTitle=doc.type==='invoice'?'INVOICE DETAILS':doc.type==='quotation'?'QUOTATION DETAILS':'DOCUMENT DETAILS';
    c.text(M,top+113,detailsTitle,8,true,C.navy);
    if(doc.type==='invoice'&&doc.templateName)c.text(M+100,top+113,'Template: '+doc.templateName,7,false,C.muted);
    const state=stateLabel(doc.placeOfSupplyStateCode);
    if(state)c.text(right,top+113,'PLACE OF SUPPLY: '+state,7.3,true,C.muted,'right');
    if(doc.type==='challan') {
      let detailsTop=top+128;
      if(doc.vehicleNumber)c.text(M,detailsTop,'Vehicle No: '+doc.vehicleNumber,7.2,false,C.muted);
      if(doc.transporterName)c.text(M+205,detailsTop,'Transporter: '+doc.transporterName,7.2,false,C.muted);
      if(doc.ewayBillNumber)c.text(M,detailsTop+12,'E-Way Bill: '+doc.ewayBillNumber,7.2,false,C.muted);
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
      c.rect(M, top, CW, 20, C.purple);
      c.line(M, top + 20, right, top + 20, C.rowBorder, 0.65);
      let x = M;
      widths.forEach((w, i) => {
        const align = i === 2 || i === 3 ? 'center' : i >= 4 ? 'right' : 'left';
        const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - 7 : x + 7;
        c.text(tx, top + 6, labels[i], 8, true, C.white, align);
        x += w;
      });
    } else {
      c.rect(M,top,CW,23,C.navy);let x=M;
      widths.forEach((w,i)=>{const align=i>=3?'right':'left';c.text(align==='right'?x+w-5:x+5,top+7,labels[i],6.7,true,C.white,align);x+=w;});
    }
    return top + (doc.type === 'invoice' || doc.type === 'quotation' ? 20 : 23);
  };

  header(false);
  let y=drawParties(147)+4;
  y=tableHeader(y);
  const items=canonical.items.length?canonical.items:[{name:'No line items supplied',description:'',unit:'pcs',quantity:0,unitPrice:0,discount:0,taxRate:0,amount:0,hsn:undefined}];
  items.forEach((it,i)=>{
    const originalItem=doc.items[i];
    if (doc.type === 'invoice' || doc.type === 'quotation') {
      const nameLines = wrap(it.name || it.description || 'Item', 36).slice(0, 2);
      const detailLines = it.description && it.description !== it.name ? wrap(it.description, 39).slice(0, 2) : [];
      const rh = Math.max(32, nameLines.length * 10 + detailLines.length * 9 + (it.hsn ? 8 : 0) + 9);
      if (y + rh > FOOTER_TOP - 4) { c.newPage(); header(true); y = tableHeader(154); }
      c.line(M, y + rh, right, y + rh, C.rowBorder, 0.5);
      const xs: number[] = []; let xx = M; for (const w of widths) { xs.push(xx); xx += w; }
      c.text(xs[0] + 5, y + 9, i + 1, 7.5, false, C.muted);
      nameLines.forEach((line, j) => c.text(xs[1] + 7, y + 7 + j * 10, line, 8.5, true, C.navy));
      detailLines.forEach((line, j) => c.text(xs[1] + 7, y + 7 + nameLines.length * 10 + j * 9, line, 7.5, false, C.muted));
      if (it.hsn) c.text(xs[1] + 7, y + 7 + nameLines.length * 10 + detailLines.length * 9, 'HSN / SAC: ' + it.hsn, 6.5, false, C.muted);
      c.text(xs[2] + widths[2] / 2, y + 9, ascii(it.quantity), 7.7, false, C.ink, 'center');
      c.text(xs[3] + widths[3] / 2, y + 9, ascii(originalItem?.unit || it.unit || 'pcs').toUpperCase(), 7.0, true, C.muted, 'center');
      c.text(xs[4] + widths[4] - 6, y + 9, money(it.unitPrice, canonical.document.currency), 7.5, false, C.ink, 'right');
      c.text(xs[5] + widths[5] - 6, y + 9, money(it.amount, canonical.document.currency), 7.8, true, C.navy, 'right');
      y += rh;
    } else {
      const desc=wrap(it.name||it.description,31).slice(0,3), rh=Math.max(25,desc.length*9+10);
      if(y+rh>FOOTER_TOP-4){c.newPage();header(true);y=tableHeader(154);}
      if(i%2===1)c.rect(M,y,CW,rh,C.pale);
      c.line(M,y+rh,right,y+rh,C.border,0.45);
      const xs:number[]=[];let xx=M;for(const w of widths){xs.push(xx);xx+=w;}
      c.text(xs[0]+5,y+8,i+1,7,false,C.muted);
      desc.forEach((v,j)=>c.text(xs[1]+5,y+6+j*9,v,7.2,j===0,C.ink));
      c.text(xs[2]+4,y+8,it.hsn||'-',6.6,false,C.muted);
      c.text(xs[3]+widths[3]-5,y+8,ascii(it.quantity)+(originalItem?.unit?' '+ascii(originalItem.unit).slice(0,4):''),6.9,false,C.ink,'right');
      c.text(xs[4]+widths[4]-5,y+8,money(it.unitPrice,canonical.document.currency),6.5,false,C.ink,'right');
      c.text(xs[5]+widths[5]-5,y+8,it.discount?money(it.discount,canonical.document.currency):'-',6.5,false,C.ink,'right');
      const taxable=Math.max(0,it.quantity*it.unitPrice-it.discount);
      c.text(xs[6]+widths[6]-5,y+8,money(taxable,canonical.document.currency),6.5,false,C.ink,'right');
      c.text(xs[7]+widths[7]-5,y+8,money(it.amount,canonical.document.currency),6.5,true,C.ink,'right');
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
    if (canonical.financials.taxBreakdown.length) {
      canonical.financials.taxBreakdown.forEach(line => rows.push([
        line.rate > 0 ? line.name + ' (' + line.rate + '%)' : line.name,
        line.amount, 'normal'
      ]));
    } else if (doc.taxTotal !== 0) rows.push(['Tax / GST', doc.taxTotal, 'normal']);
    rows.push(['Net Payable', canonical.financials.grandTotal, 'total']);
    if (canonical.financials.amountPaid > 0) rows.push(['Amount paid', canonical.financials.amountPaid, 'normal']);
    rows.push(['Balance due', canonical.financials.balanceDue, 'balance']);

    c.line(totalX, summaryTop, right, summaryTop, C.border, 0.7);
    let totalY = summaryTop + 5;
    for (const [label, value, kind] of rows) {
      const rowH = kind === 'normal' ? 15 : 19;
      if (kind === 'total') c.roundRect(totalX, totalY, totalW, rowH, 4, C.pale);
      if (kind === 'balance') c.roundRect(totalX, totalY, totalW, rowH, 4, [1, 0.97, 0.94] as RGB);
      const emphasized = kind !== 'normal' || label === 'Subtotal' || /^(IGST|CGST|SGST|Tax|GST)(\b|\s|\/)/i.test(label);
      const col = emphasized ? C.amber : C.navy;
      c.text(totalX + 8, totalY + 4, label, emphasized ? 8.1 : 7.6, emphasized, col);
      c.text(right - 8, totalY + 4, (value < 0 ? '-' : '') + money(Math.abs(value), doc.currencyCode),
        emphasized ? 8.1 : 7.6, emphasized, col, 'right');
      totalY += rowH + 1;
    }

    const amountWords = wrap(canonical.financials.amountInWords, 36).slice(0, 3);
    const wordsTop = totalY + 7;
    const wordsHeight = Math.max(32, 17 + amountWords.length * 9);
    c.roundRect(totalX, wordsTop, totalW, wordsHeight, 5, C.pale, C.border, 0.6);
    c.text(totalX + 8, wordsTop + 5, 'AMOUNT IN WORDS:', 7.2, true, C.purple);
    amountWords.forEach((line, index) => c.text(totalX + 8, wordsTop + 16 + index * 8, line, 7.2, false, C.navy));

    const sigX = right - 175;
    const sigY = wordsTop + wordsHeight + 10;
    c.text(right, sigY, 'For ' + (doc.business.legalName || doc.business.name), 8, false, C.muted, 'right');
    c.line(sigX + 45, sigY + 38, sigX + 175, sigY + 38, C.border, 0.7);
    c.text(right, sigY + 42, 'Authorized Signatory', 7.5, true, C.navy, 'right');
    invoiceSignatureEndY = sigY + 53;
    invoiceSettlementTop = summaryTop;
    y = Math.max(invoiceSettlementTop, invoiceSignatureEndY) + 8;
  } else {
  if(y+190>FOOTER_TOP-4){c.newPage();header(true);y=154;}else y+=12;

  const totalX=342,totalW=right-totalX,wordX=M;
  c.text(wordX,y+2,'AMOUNT IN WORDS:',7.2,true,C.purple);
  drawWrap(c,wordX,y+16,canonical.financials.amountInWords,42,8.1,true,C.navy,3);
  c.rect(totalX,y-2,totalW,18,C.pale,C.border);
  c.text(totalX+8,y+3,'FINANCIAL SUMMARY',7.3,true,C.indigo);y+=20;
  const summary:Array<[string,number,boolean]> = doc.type === 'challan'
    ? [['Declared Value',canonical.financials.grandTotal,true]]
    : [
      ['Subtotal',canonical.financials.subtotal,false],
      ['Trade Discount',-Math.abs(canonical.financials.totalDiscount),false],
      ['Taxable Value',Math.max(0,canonical.financials.subtotal-canonical.financials.totalDiscount),false]
    ];
  if(doc.type !== 'challan') {
    if(canonical.financials.taxBreakdown.length) {
      canonical.financials.taxBreakdown.forEach(line => summary.push([
        line.rate>0 ? line.name+' ('+line.rate+'%)' : line.name,
        line.amount,
        false
      ]));
    }
    summary.push(['Round Off',canonical.financials.roundOff,false],['Grand Total',canonical.financials.grandTotal,true]);
  }
  for(const [label,value,bold] of summary){
    if(y+15>FOOTER_TOP-4){c.newPage();header(true);y=154;}
    if(bold)c.rect(totalX,y-1,totalW,17,label==='Grand Total'?C.navy:C.pale);
    const color=bold&&label==='Grand Total'?C.white:C.ink;
    c.text(totalX+7,y+2,label,label==='Grand Total'?8.1:7.5,bold,color);
    c.text(right-7,y+2,(value<0?'-':'')+money(Math.abs(value),doc.currencyCode),label==='Grand Total'?8.2:7.4,bold,color,'right');
    y+=16;
  }
  if (doc.type === 'quotation') {
    if (y + 62 > FOOTER_TOP - 4) { c.newPage(); header(true); y = 154; }
    const sigX = right - 175, sigY = y + 8;
    c.text(right, sigY, 'For ' + (doc.business.legalName || doc.business.name), 8, false, C.muted, 'right');
    c.line(sigX + 45, sigY + 38, sigX + 175, sigY + 38, C.border, 0.7);
    c.text(right, sigY + 42, 'Authorized Signatory', 7.5, true, C.navy, 'right');
    y = sigY + 53;
  }
  }
  if(doc.type==='challan'){
    if(y+38>FOOTER_TOP-4){c.newPage();header(true);y=154;}
    c.rect(M,y,CW,30,C.pale,C.border);
    c.text(M+8,y+5,'SUPPLY ON APPROVAL / JOB WORK / EXHIBITION / TRANSPORTATION ONLY',7.1,true,C.navy);
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
      c.roundRect(cardX, cardY, cardW, cardH, 6, C.white, C.border, 0.75);
      c.text(cardX + cardW / 2, cardY + 8, bothSettlement ? 'PAYMENT SETTLEMENT' : showQrSettlement ? 'SCAN & PAY VIA UPI' : 'BANK DETAILS', 8, true, C.purple, 'center');

      if (showBankSettlement && doc.bankDetails) {
        const b = doc.bankDetails;
        const bankTop = cardY + 23;
        c.text(cardX + 9, bankTop, b.institutionName || b.name || 'Bank', 7.5, true, C.navy);
        c.text(cardX + 9, bankTop + 12, 'Account Holder: ' + (b.accountHolderName || doc.business.name), 7.1, false, C.muted);
        c.text(cardX + 9, bankTop + 23, 'A/C No: ' + (b.accountNumber || (b.accountLast4 ? 'XXXX ' + b.accountLast4 : '-')), 7.1, false, C.muted);
        c.text(cardX + 9, bankTop + 34, 'IFSC: ' + (b.ifscCode || '-'), 7.1, false, C.muted);
        c.text(cardX + 9, bankTop + 45, 'Branch: ' + (b.branchName || '-'), 7.1, false, C.muted);
      }

      if (showQrSettlement && qrData) {
        const buttonW = 100, buttonH = 16;
        const buttonX = cardX + (cardW - buttonW) / 2;
        const buttonY = cardY + (bothSettlement ? 79 : 22);
        c.roundRect(buttonX, buttonY, buttonW, buttonH, 8, C.purple);
        c.text(buttonX + buttonW / 2, buttonY + 4, 'Pay Now via UPI', 6.8, true, C.white, 'center');
        c.addLink(buttonX, buttonY, buttonW, buttonH, doc.paymentLink || qrData);
        const qrSize = 65;
        const qrX = cardX + (cardW - qrSize) / 2;
        const qrY = cardY + (bothSettlement ? 99 : 42);
        c.rect(qrX, qrY, qrSize, qrSize, C.white, C.border, 0.4);
        const q = QRCode.create(qrData, { errorCorrectionLevel: 'M' }), n = q.modules.size;
        const area = 57, quiet = 4, cell = area / n, qx = qrX + quiet, qy = qrY + quiet;
        for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
          if (q.modules.data[row * n + col]) c.rect(qx + col * cell, qy + row * cell, cell + 0.025, cell + 0.025, C.navy);
        }
        c.text(cardX + cardW / 2, qrY + qrSize + 3, 'Scan to pay the invoice amount.', 6.0, false, C.muted, 'center');
      }
      renderedPaymentCardHeight = cardH;
    }
    let infoY = (invoiceSettlementTop ?? y) + renderedPaymentCardHeight + (renderedPaymentCardHeight ? 12 : 0);
    c.text(M, infoY, 'TERMS & CONDITIONS', 8, true, C.purple); infoY += 13;
    const terms = doc.terms ? wrap(doc.terms, 47).slice(0, 4) : ['—'];
    terms.forEach(line => { c.text(M, infoY, line, 7.3, false, C.muted); infoY += 10; });
    infoY += 5;
    c.text(M, infoY, 'NOTES', 8, true, C.purple); infoY += 13;
    const noteLines = doc.notes ? wrap(doc.notes, 47).slice(0, 3) : ['—'];
    noteLines.forEach(line => { c.text(M, infoY, line, 7.3, false, C.muted); infoY += 10; });
    y = Math.max(infoY + 8, invoiceSignatureEndY + 8);
  } else {
    if (showBankSettlement || showQrSettlement) {
      const sectionH=showQrSettlement?100:76;
      if(y+sectionH>FOOTER_TOP-4){c.newPage();header(true);y=154;}
    c.line(M,y,right,y,C.border,0.75);y+=8;c.text(M,y,'PAYMENT / SETTLEMENT DETAILS',8,true,C.navy);y+=15;
    if(showBankSettlement&&doc.bankDetails){
      const b=doc.bankDetails;
      c.text(M,y,b.institutionName||b.name||'Bank',8.1,true,C.ink);
      c.text(M,y+13,'A/C Holder: '+(b.accountHolderName||doc.business.name),7.3,false,C.muted);
      c.text(M,y+25,'A/C No: '+(b.accountNumber||(b.accountLast4?'XXXX '+b.accountLast4:'-')),7.3,false,C.muted);
      c.text(M,y+37,'IFSC: '+(b.ifscCode||'-')+'   Branch: '+(b.branchName||'-'),7.3,false,C.muted);
    }
    if(showQrSettlement&&qrData){
      const q=QRCode.create(qrData,{errorCorrectionLevel:'M'}), n=q.modules.size, area=72, cell=area/n, qx=right-area, qy=y-2;
      c.rect(qx-4,qy-4,area+8,area+8,C.white,C.border);
      for(let row=0;row<n;row++)for(let col=0;col<n;col++)if(q.modules.data[row*n+col])c.rect(qx+col*cell,qy+row*cell,cell+0.04,cell+0.04,C.ink);
      c.text(qx+area/2,qy+area+5,'SCAN TO PAY',6.5,true,C.muted,'center');
    }
    y+=showQrSettlement?88:45;
  }

  }
  if (doc.type !== 'invoice') {
    const legalTerms = doc.terms || null;
    if(doc.notes||legalTerms){
      const lines=[...(doc.notes?wrap('Notes: '+doc.notes,100):[]),...(legalTerms?wrap('Terms: '+legalTerms,100):[])],needed=22+lines.length*10;
      if(y+needed>FOOTER_TOP-4){c.newPage();header(true);y=154;}
      c.line(M,y,right,y);y+=8;c.text(M,y,'TERMS & CONDITIONS',7.8,true,C.navy);y+=13;
      lines.slice(0,6).forEach(s=>{c.text(M,y,s,7,false,C.muted);y+=10;});
    }
  }
  const pageCount=c.pages.length;
  const footerText = doc.type === 'invoice'
    ? 'This is a computer-generated invoice and does not require signature.'
    : doc.type === 'quotation'
      ? 'This is a computer-generated quotation and does not require signature.'
      : 'Generated via Moneymatters FinOps | Join Moneymatters for free at mm.nilanga.in';
  const poweredText = 'Powered by Moneymatters FinOps | mm.nilanga.in';
  for (let i = 0; i < pageCount; i++) {
    const page = c.pages[i];
    page.commands.push(rgb(C.purple) + ' RG 1.50 w ' + M + ' ' + (H - 780).toFixed(2) + ' m ' + right + ' ' + (H - 780).toFixed(2) + ' l S');
    page.commands.push(rgb(C.border) + ' RG 0.50 w ' + M + ' ' + (H - 783).toFixed(2) + ' m ' + right + ' ' + (H - 783).toFixed(2) + ' l S');
    const footerSize = 7.5;
    const footerX = (W - approxWidth(footerText, footerSize, false)) / 2;
    const footerBaseline = H - 792 - footerSize;
    page.commands.push(rgb(C.muted) + ' rg BT /F1 ' + footerSize.toFixed(2) + ' Tf 1 0 0 1 ' + footerX.toFixed(2) + ' ' + footerBaseline.toFixed(2) + ' Tm (' + esc(footerText) + ') Tj ET');
    const poweredX = (W - approxWidth(poweredText, 7, false)) / 2;
    const poweredBaseline = H - 803 - 7;
    page.commands.push(rgb(C.muted) + ' rg BT /F1 7.00 Tf 1 0 0 1 ' + poweredX.toFixed(2) + ' ' + poweredBaseline.toFixed(2) + ' Tm (' + esc(poweredText) + ') Tj ET');
  }
  if(logo&&logoId)objects[logoId-1]=Buffer.concat([
    Buffer.from('<< /Type /XObject /Subtype /Image /Width '+logo.width+' /Height '+logo.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+logo.bytes.length+' >>\nstream\n','ascii'),
    logo.bytes,Buffer.from('\nendstream','ascii')
  ]);
  const pageIds:number[]=[];
  for(const p of c.pages){
    const xObjects=logo&&logoId&&p.usesLogo?'/XObject << /Logo '+logoId+' 0 R >>':'';
    const resources='<< /Font << /F1 '+font1+' 0 R /F2 '+font2+' 0 R >> '+xObjects+' >>';
    const pid=add('');
    pageIds.push(pid);
    const annotationIds:number[]=[];
    for (const link of p.links) {
      const aid=add('');
      const rect='['+link.x.toFixed(2)+' '+(H-link.top-link.height).toFixed(2)+' '+(link.x+link.width).toFixed(2)+' '+(H-link.top).toFixed(2)+']';
      objects[aid-1]='<< /Type /Annot /Subtype /Link /Rect '+rect+' /Border [0 0 0] /A << /S /URI /URI ('+esc(link.uri)+') >> /P '+pid+' 0 R >>';
      annotationIds.push(aid);
    }
    const stream=Buffer.from(p.commands.join('\n')+'\n','ascii');
    const sid=add(Buffer.concat([Buffer.from('<< /Length '+stream.length+' >>\nstream\n','ascii'),stream,Buffer.from('endstream','ascii')]));
    const annots=annotationIds.length?' /Annots ['+annotationIds.map(id=>id+' 0 R').join(' ')+']':'';
    objects[pid-1]='<< /Type /Page /Parent '+pagesId+' 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources '+resources+' /Contents '+sid+' 0 R'+annots+' >>';
  }
  objects[catalogId-1]='<< /Type /Catalog /Pages '+pagesId+' 0 R >>';
  objects[pagesId-1]='<< /Type /Pages /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] /Count '+pageIds.length+' >>';
  const chunks:Buffer[]=[Buffer.from('%PDF-1.4\n%Moneymatters FinOps\n','ascii')],offsets:number[]=[0];
  for(let i=0;i<objects.length;i++){
    offsets.push(chunks.reduce((sum,b)=>sum+b.length,0));
    const body=typeof objects[i]==='string'?Buffer.from(objects[i] as string,'ascii'):objects[i] as Buffer;
    chunks.push(Buffer.from((i+1)+' 0 obj\n','ascii'),body,Buffer.from('\nendobj\n','ascii'));
  }
  const xrefOffset=chunks.reduce((sum,b)=>sum+b.length,0),xref=['xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'];
  for(let i=1;i<offsets.length;i++)xref.push(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
  xref.push('trailer\n<< /Size '+(objects.length+1)+' /Root '+catalogId+' 0 R >>\nstartxref\n'+xrefOffset+'\n%%EOF\n');
  chunks.push(Buffer.from(xref.join(''),'ascii'));
  return Buffer.concat(chunks);
}
