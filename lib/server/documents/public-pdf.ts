import type { PublicDocument } from './public-tokens';
import { canonicalAddress, createCanonicalDocumentViewModel } from '../../shared/document-view-model.ts';
import QRCode from 'qrcode';

const W = 595.28, H = 841.89, M = 36, CW = W - M * 2, FOOTER_TOP = H - 36;
type RGB = readonly [number, number, number];
type PdfLink = { x: number; top: number; width: number; height: number; uri: string };
type Page = { commands: string[]; usesLogo: boolean; links: PdfLink[] };
const C = {
  purple: [0.486, 0.227, 0.929] as RGB, indigo: [0.486, 0.227, 0.929] as RGB,
  navy: [0.059, 0.090, 0.165] as RGB, ink: [0.059, 0.090, 0.165] as RGB,
  muted: [0.392, 0.455, 0.545] as RGB, border: [0.886, 0.910, 0.941] as RGB,
  pale: [0.945, 0.957, 0.976] as RGB, white: [1, 1, 1] as RGB,
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
const docTitle = (type: string) => type === 'invoice' ? 'TAX INVOICE' : type === 'quotation' ? 'QUOTATION' : type === 'challan' ? 'DELIVERY CHALLAN' : 'PAYMENT RECEIPT';
const statusColor = (s: string): RGB => ['paid','accepted','delivered'].includes(s.toLowerCase()) ? C.green :
  ['overdue','void','cancelled'].includes(s.toLowerCase()) ? C.red : C.amber;

export async function buildPublicDocumentPdf(doc: PublicDocument): Promise<Buffer> {
  const canonical = createCanonicalDocumentViewModel(doc, { type: doc.type, upiId: doc.upiId });
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
      if (logo && logoId) {
        const scale = Math.min(58 / logo.width, 45 / logo.height);
        c.imageLogo(M, 36, logo.width * scale, logo.height * scale);
      } else {
        c.roundRect(M, 37, 54, 43, 7, C.pale, C.border);
        c.text(M + 27, 51, wrap(doc.business.name, 2)[0].slice(0, 2).toUpperCase(), 12, true, C.purple, 'center');
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
    c.text(rx+12,67,doc.type==='invoice'?'INVOICE NO.':'DOCUMENT NO.',6.5,true,[0.78,0.82,0.91]);
    c.text(rx+12,77,doc.number,9.2,true,C.white);
    c.text(rx+12,93,'DATE  '+dateLabel(doc.date),7.2,false,C.white);
    if(doc.dueDate)c.text(rx+12,106,'DUE  '+dateLabel(doc.dueDate),7.2,false,C.white);
    else if(doc.validUntil)c.text(rx+12,106,'VALID UNTIL  '+dateLabel(doc.validUntil),7.2,false,C.white);
    c.line(M,135,right,135,C.border,0.8);
  };
  const partyRows=(address:unknown,phone:string|null,email:string|null,taxId:string|null)=>
    [...addressParts(address).slice(0,2),phone||'',email||'',taxId?'GSTIN: '+taxId:''].filter(Boolean);
  const drawParties=(top:number)=>{
    if (doc.type === 'invoice') {
      const gap = 22, colW = (CW - gap) / 2, rx = M + colW + gap;
      c.text(M, top, 'BILL TO', 8, true, C.muted);
      c.text(M, top + 15, canonical.customer.name, 10, true, C.navy);
      let billY = top + 29;
      const billRows = [
        ...addressParts(canonical.customer.billingAddress || canonicalAddress(doc.customer.address)),
        canonical.customer.phone || '',
        canonical.customer.email || '',
        canonical.customer.gstin ? 'GSTIN: ' + canonical.customer.gstin : ''
      ].filter(Boolean).slice(0, 5);
      billRows.forEach((v) => {
        drawWrap(c, M, billY, v, 48, 7.2, false, C.muted, 1);
        billY += 9;
      });
      c.line(M + colW + gap / 2, top - 1, M + colW + gap / 2, top + 72, C.border, 0.6);
      c.text(rx, top, 'INVOICE SUMMARY', 8, true, C.muted);
      c.text(rx, top + 16, 'Template: ' + (doc.templateName || 'Business default'), 7.5, false, C.muted);
      c.roundRect(rx, top + 28, colW, 31, 6, [1, 0.97, 0.94] as RGB, [0.98, 0.87, 0.78] as RGB);
      c.text(rx + 9, top + 38, 'Balance due', 7.2, true, C.amber);
      c.text(rx + colW - 9, top + 36, money(canonical.financials.balanceDue, canonical.document.currency), 9.1, true, C.amber, 'right');
      c.line(M, top + 78, right, top + 78, C.border, 0.65);
      return top + 90;
    }

    const gap=10,colW=(CW-gap)/2,boxH=100;
    const list=[
      {x:M,label:'BILLED TO',name:canonical.customer.name,rows:partyRows(canonical.customer.billingAddress||canonicalAddress(doc.customer.address),canonical.customer.phone||null,canonical.customer.email||null,canonical.customer.gstin||null)},
      {x:M+colW+gap,label:'SHIPPED TO',name:canonical.customer.name,rows:partyRows(canonical.customer.shippingAddress||canonical.customer.billingAddress,null,null,null)}
    ];
    for(const p of list){
      c.rect(p.x,top,colW,boxH,C.white,C.border); c.rect(p.x,top,colW,19,C.pale);
      c.text(p.x+10,top+5,p.label,8,true,C.indigo); c.text(p.x+10,top+25,p.name,9.1,true,C.navy);
      p.rows.slice(0,5).forEach((v,i)=>drawWrap(c,p.x+10,top+40+i*10,v,43,7.3,false,C.muted,1));
    }
    c.text(M,top+113,doc.type==='invoice'?'GOODS / SERVICES':'DOCUMENT DETAILS',8,true,C.navy);
    const state=stateLabel(doc.placeOfSupplyStateCode);
    if(state)c.text(right,top+113,'PLACE OF SUPPLY: '+state,7.3,true,C.muted,'right');
    if(doc.type==='invoice'&&doc.supplyType)c.text(right,top+124,'Supply: '+doc.supplyType.replace(/_/g,' '),7,false,C.muted,'right');
    if(doc.type==='challan') {
      let detailsTop=top+128;
      if(doc.vehicleNumber)c.text(M,detailsTop,'Vehicle No: '+doc.vehicleNumber,7.2,false,C.muted);
      if(doc.transporterName)c.text(M+205,detailsTop,'Transporter: '+doc.transporterName,7.2,false,C.muted);
      if(doc.ewayBillNumber)c.text(M,detailsTop+12,'E-Way Bill: '+doc.ewayBillNumber,7.2,false,C.muted);
      return top+(doc.ewayBillNumber?160:(doc.vehicleNumber||doc.transporterName?148:124));
    }
    return top+(doc.type==='invoice'&&doc.supplyType?134:124);
  };

  const widths = doc.type === 'invoice' ? [270, 60, 92, CW - 422] : [22,144,47,39,60,52,82,77];
  const labels = doc.type === 'invoice'
    ? ['ITEM / DESCRIPTION', 'QTY', 'RATE', 'AMOUNT']
    : ['#','Item Description','HSN/SAC','Qty','Unit Rate','Discount','Taxable Amt','Total'];
  const tableHeader=(top:number)=>{
    if (doc.type === 'invoice') {
      c.rect(M, top, CW, 24, C.pale);
      c.line(M, top, right, top, C.border, 0.65);
      c.line(M, top + 24, right, top + 24, C.border, 0.65);
      let x = M;
      widths.forEach((w, i) => {
        const align = i > 0 ? 'right' : 'left';
        c.text(align === 'right' ? x + w - 8 : x + 8, top + 8, labels[i], 7.1, true, C.muted, align);
        x += w;
      });
    } else {
      c.rect(M,top,CW,23,C.navy);let x=M;
      widths.forEach((w,i)=>{const align=i>=3?'right':'left';c.text(align==='right'?x+w-5:x+5,top+7,labels[i],6.7,true,C.white,align);x+=w;});
    }
    return top + (doc.type === 'invoice' ? 24 : 23);
  };

  header(false);
  let y=drawParties(147)+4;
  y=tableHeader(y);
  const items=canonical.items.length?canonical.items:[{description:'No line items supplied',quantity:0,unitPrice:0,discount:0,taxRate:0,amount:0,hsn:undefined}];
  items.forEach((it,i)=>{
    const originalItem=doc.items[i];
    if (doc.type === 'invoice') {
      const desc = wrap(it.description, 48).slice(0, 2);
      const rh = Math.max(30, desc.length * 10 + (it.hsn ? 8 : 0) + 8);
      if (y + rh > FOOTER_TOP - 4) { c.newPage(); header(true); y = tableHeader(78); }
      c.line(M, y + rh, right, y + rh, C.border, 0.5);
      const xs: number[] = []; let xx = M; for (const w of widths) { xs.push(xx); xx += w; }
      desc.forEach((v, j) => c.text(xs[0] + 8, y + 7 + j * 10, v, j === 0 ? 8.2 : 7.4, j === 0, j === 0 ? C.navy : C.muted));
      if (it.hsn) c.text(xs[0] + 8, y + 7 + desc.length * 10, 'HSN / SAC: ' + it.hsn, 6.5, false, C.muted);
      c.text(xs[1] + widths[1] - 8, y + 9, ascii(it.quantity) + (originalItem?.unit ? ' ' + ascii(originalItem.unit).slice(0, 5) : ''), 7.7, false, C.ink, 'right');
      c.text(xs[2] + widths[2] - 8, y + 9, money(it.unitPrice, canonical.document.currency), 7.5, false, C.ink, 'right');
      c.text(xs[3] + widths[3] - 8, y + 9, money(it.amount, canonical.document.currency), 7.8, true, C.navy, 'right');
      y += rh;
    } else {
      const desc=wrap(it.description,31).slice(0,3), rh=Math.max(25,desc.length*9+10);
      if(y+rh>FOOTER_TOP-4){c.newPage();header(true);y=tableHeader(78);}
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
  if (doc.type === 'invoice') {
    if (y + 172 > FOOTER_TOP - 4) { c.newPage(); header(true); y = tableHeader(78); }
    y += 14;
    const summaryTop = y;
    const totalW = 205, totalX = right - totalW;
    c.text(M, summaryTop, 'NOTES', 8, true, C.navy);
    let leftY = summaryTop + 14;
    if (doc.notes) {
      const noteLines = wrap(doc.notes, 48).slice(0, 4);
      noteLines.forEach(line => { c.text(M, leftY, line, 7.3, false, C.muted); leftY += 10; });
      leftY += 7;
    } else {
      c.text(M, leftY, '—', 7.3, false, C.muted); leftY += 10;
      leftY += 7;
    }
    c.text(M, leftY, 'TERMS & CONDITIONS', 8, true, C.navy);
    leftY += 14;
    const terms = doc.terms ? wrap(doc.terms, 48).slice(0, 5) : ['Payment due as per agreed terms.'];
    terms.forEach(line => { c.text(M, leftY, line, 7.3, false, C.muted); leftY += 10; });

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
    rows.push(['Total', canonical.financials.grandTotal, 'total']);
    if (canonical.financials.amountPaid > 0) rows.push(['Amount paid', canonical.financials.amountPaid, 'normal']);
    rows.push(['Balance due', canonical.financials.balanceDue, 'balance']);

    c.line(totalX, summaryTop, right, summaryTop, C.border, 0.7);
    let totalY = summaryTop + 5;
    for (const [label, value, kind] of rows) {
      const rowH = kind === 'normal' ? 15 : 19;
      if (kind === 'total') c.roundRect(totalX, totalY, totalW, rowH, 4, C.pale);
      if (kind === 'balance') c.roundRect(totalX, totalY, totalW, rowH, 4, [1, 0.97, 0.94] as RGB);
      const col = kind === 'balance' ? C.amber : C.navy;
      c.text(totalX + 8, totalY + 4, label, kind === 'normal' ? 7.6 : 8.3, kind !== 'normal', col);
      c.text(right - 8, totalY + 4, (value < 0 ? '-' : '') + money(Math.abs(value), doc.currencyCode),
        kind === 'normal' ? 7.6 : 8.3, kind !== 'normal', col, 'right');
      totalY += rowH + 1;
    }
    y = Math.max(leftY, totalY) + 12;
  } else {
  if(y+190>FOOTER_TOP-4){c.newPage();header(true);y=82;}else y+=12;

  const totalX=342,totalW=right-totalX,wordX=M;
  c.text(wordX,y+2,'TOTAL IN WORDS',7.2,true,C.muted);
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
    if(doc.type==='invoice')summary.push(['Amount Paid',canonical.financials.amountPaid,false],['Balance Due',canonical.financials.balanceDue,true]);
  }
  for(const [label,value,bold] of summary){
    if(y+15>FOOTER_TOP-4){c.newPage();header(true);y=80;}
    if(bold)c.rect(totalX,y-1,totalW,17,label==='Grand Total'?C.navy:C.pale);
    const color=bold&&label==='Grand Total'?C.white:C.ink;
    c.text(totalX+7,y+2,label,label==='Grand Total'?8.1:7.5,bold,color);
    c.text(right-7,y+2,(value<0?'-':'')+money(Math.abs(value),doc.currencyCode),label==='Grand Total'?8.2:7.4,bold,color,'right');
    y+=16;
  }

  }
  if(doc.type==='challan'){
    if(y+38>FOOTER_TOP-4){c.newPage();header(true);y=80;}
    c.rect(M,y,CW,30,C.pale,C.border);
    c.text(M+8,y+5,'SUPPLY ON APPROVAL / JOB WORK / EXHIBITION / TRANSPORTATION ONLY',7.1,true,C.navy);
    c.text(M+8,y+17,'NOT FOR SALE / NOT A TAX INVOICE',8,true,C.red);
    y+=38;
  }
  y += 5;
  const qrData = canonical.financials.upiQrString
    || (doc.type === 'invoice' && String(doc.currencyCode).toUpperCase() === 'INR' && doc.balanceDue > 0
      && doc.paymentQrPayload?.startsWith('upi://pay?') ? doc.paymentQrPayload : null);

  if (doc.type === 'invoice') {
    if (doc.bankDetails || qrData) {
      const sectionH = qrData ? 174 : 104;
      if (y + sectionH > FOOTER_TOP - 4) { c.newPage(); header(true); y = 80; }
      const cardX = M, cardW = CW;
      c.roundRect(cardX, y, cardW, sectionH, 9, C.white, [0.796, 0.835, 0.882] as RGB, 0.75);
      c.text(W / 2, y + 10, 'PAYMENT', 10, true, C.navy, 'center');

      if (qrData && doc.bankDetails) {
        const bankX = cardX + 12, bankY = y + 29, bankW = 218, bankH = sectionH - 41;
        c.roundRect(bankX, bankY, bankW, bankH, 7, C.pale, C.border, 0.6);
        const b = doc.bankDetails;
        c.text(bankX + 10, bankY + 10, b.institutionName || b.name || 'Bank', 8.1, true, C.navy);
        c.text(bankX + 10, bankY + 27, 'Account holder: ' + (b.accountHolderName || doc.business.name), 7.0, false, C.muted);
        c.text(bankX + 10, bankY + 42, 'A/C No: ' + (b.accountNumber || (b.accountLast4 ? 'XXXX ' + b.accountLast4 : '-')), 7.0, false, C.muted);
        c.text(bankX + 10, bankY + 57, 'IFSC: ' + (b.ifscCode || '-'), 7.0, false, C.muted);
        if (b.branchName) c.text(bankX + 10, bankY + 72, 'Branch: ' + b.branchName, 7.0, false, C.muted);
        if (b.accountType) c.text(bankX + 10, bankY + 87, 'Account type: ' + b.accountType, 7.0, false, C.muted);
        if (doc.upiId) c.text(bankX + 10, bankY + 102, 'UPI: ' + doc.upiId, 7.0, false, C.muted);

        const payX = bankX + bankW + 10, payW = cardX + cardW - 12 - payX;
        const buttonW = Math.min(142, payW - 8), buttonH = 22, buttonX = payX + (payW - buttonW) / 2;
        const buttonY = y + 28;
        c.roundRect(buttonX, buttonY, buttonW, buttonH, 11, C.purple);
        c.text(buttonX + buttonW / 2, buttonY + 6, 'Pay Now via UPI', 7.8, true, C.white, 'center');
        c.addLink(buttonX, buttonY, buttonW, buttonH, qrData);
        const qrOuter = 90, qrX = payX + (payW - qrOuter) / 2, qrY = buttonY + buttonH + 7;
        c.rect(qrX, qrY, qrOuter, qrOuter, C.white, C.border, 0.4);
        const q = QRCode.create(qrData, { errorCorrectionLevel: 'M' }), n = q.modules.size;
        const area = 72, quiet = 9, cell = area / n, qx = qrX + quiet, qy = qrY + quiet;
        for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
          if (q.modules.data[row * n + col]) c.rect(qx + col * cell, qy + row * cell, cell + 0.025, cell + 0.025, C.navy);
        }
        c.text(qrX + qrOuter / 2, qrY + qrOuter + 2, 'Scan to pay the invoice amount.', 7, false, C.muted, 'center');
      } else if (qrData) {
        const buttonW = 142, buttonH = 22, buttonX = cardX + (cardW - buttonW) / 2, buttonY = y + 28;
        c.roundRect(buttonX, buttonY, buttonW, buttonH, 11, C.purple);
        c.text(buttonX + buttonW / 2, buttonY + 6, 'Pay Now via UPI', 7.8, true, C.white, 'center');
        c.addLink(buttonX, buttonY, buttonW, buttonH, qrData);
        const qrOuter = 90, qrX = cardX + (cardW - qrOuter) / 2, qrY = buttonY + buttonH + 7;
        c.rect(qrX, qrY, qrOuter, qrOuter, C.white, C.border, 0.4);
        const q = QRCode.create(qrData, { errorCorrectionLevel: 'M' }), n = q.modules.size;
        const area = 72, quiet = 9, cell = area / n, qx = qrX + quiet, qy = qrY + quiet;
        for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
          if (q.modules.data[row * n + col]) c.rect(qx + col * cell, qy + row * cell, cell + 0.025, cell + 0.025, C.navy);
        }
        c.text(qrX + qrOuter / 2, qrY + qrOuter + 2, 'Scan to pay the invoice amount.', 7, false, C.muted, 'center');
      } else if (doc.bankDetails) {
        const b = doc.bankDetails, bx = cardX + 20, by = y + 32;
        c.roundRect(bx, by, cardW - 40, 58, 7, C.pale, C.border, 0.6);
        c.text(bx + 12, by + 9, b.institutionName || b.name || 'Bank', 8.2, true, C.navy);
        c.text(bx + 12, by + 24, 'Account holder: ' + (b.accountHolderName || doc.business.name), 7.2, false, C.muted);
        c.text(bx + 12, by + 39, 'A/C No: ' + (b.accountNumber || (b.accountLast4 ? 'XXXX ' + b.accountLast4 : '-')), 7.2, false, C.muted);
        c.text(bx + 270, by + 24, 'IFSC: ' + (b.ifscCode || '-'), 7.2, false, C.muted);
        c.text(bx + 270, by + 39, 'Branch: ' + (b.branchName || '-'), 7.2, false, C.muted);
      }
      y += sectionH + 12;
    }
  } else {
  if(doc.bankDetails||qrData){
    const sectionH=qrData?100:76;
    if(y+sectionH>FOOTER_TOP-4){c.newPage();header(true);y=80;}
    c.line(M,y,right,y,C.border,0.75);y+=8;c.text(M,y,'PAYMENT / SETTLEMENT DETAILS',8,true,C.navy);y+=15;
    if(doc.bankDetails){
      const b=doc.bankDetails;
      c.text(M,y,b.institutionName||b.name||'Bank',8.1,true,C.ink);
      c.text(M,y+13,'A/C Holder: '+(b.accountHolderName||doc.business.name),7.3,false,C.muted);
      c.text(M,y+25,'A/C No: '+(b.accountNumber||(b.accountLast4?'XXXX '+b.accountLast4:'-')),7.3,false,C.muted);
      c.text(M,y+37,'IFSC: '+(b.ifscCode||'-')+'   Branch: '+(b.branchName||'-'),7.3,false,C.muted);
    }
    if(qrData){
      const q=QRCode.create(qrData,{errorCorrectionLevel:'M'}), n=q.modules.size, area=72, cell=area/n, qx=right-area, qy=y-2;
      c.rect(qx-4,qy-4,area+8,area+8,C.white,C.border);
      for(let row=0;row<n;row++)for(let col=0;col<n;col++)if(q.modules.data[row*n+col])c.rect(qx+col*cell,qy+row*cell,cell+0.04,cell+0.04,C.ink);
      c.text(qx+area/2,qy+area+5,'SCAN TO PAY',6.5,true,C.muted,'center');
    }
    y+=qrData?88:45;
  }

  }
  if (doc.type !== 'invoice') {
    const legalTerms = doc.terms || null;
    if(doc.notes||legalTerms){
      const lines=[...(doc.notes?wrap('Notes: '+doc.notes,100):[]),...(legalTerms?wrap('Terms: '+legalTerms,100):[])],needed=22+lines.length*10;
      if(y+needed>FOOTER_TOP-4){c.newPage();header(true);y=80;}
      c.line(M,y,right,y);y+=8;c.text(M,y,'TERMS & CONDITIONS',7.8,true,C.navy);y+=13;
      lines.slice(0,6).forEach(s=>{c.text(M,y,s,7,false,C.muted);y+=10;});
    }
  }
  const pageCount=c.pages.length;
  const footerText = doc.type === 'invoice'
    ? 'This is a customer-facing invoice shared by ' + doc.business.name + '.'
    : 'Generated via Moneymatters FinOps | Join Moneymatters for free at mm.nilanga.in';
  const footerX = (W - approxWidth(footerText, 6.8, false)) / 2;
  const poweredText = 'Powered by Moneymatters | mm.nilanga.in';
  const poweredX = (W - approxWidth(poweredText, 6.8, false)) / 2;
  for(let i=0;i<pageCount;i++){
    c.pages[i].commands.push(rgb(C.border)+' RG 0.55 w '+M+' 31 m '+right+' 31 l S');
    c.pages[i].commands.push(rgb(C.muted)+' rg BT /F1 6.8 Tf 1 0 0 1 '+footerX.toFixed(2)+' 25 Tm ('+esc(footerText)+') Tj ET');
    if (doc.type === 'invoice') c.pages[i].commands.push(rgb(C.purple)+' rg BT /F2 6.8 Tf 1 0 0 1 '+poweredX.toFixed(2)+' 14 Tm ('+esc(poweredText)+') Tj ET');
    else c.pages[i].commands.push(rgb(C.muted)+' rg BT /F1 7 Tf 1 0 0 1 '+(right-47).toFixed(2)+' 17 Tm (Page '+(i+1)+' of '+pageCount+') Tj ET');
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
