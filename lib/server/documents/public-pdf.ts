import type { PublicDocument } from '@/lib/server/documents/public-tokens';

const ascii = (value: unknown) => String(value ?? '').replace(/₹/g, 'Rs. ').replace(/[—–]/g, '-').normalize('NFKD').replace(/[^\x20-\x7E]/g, '?').replace(/[\r\n\u0000-\u001f]/g, ' ').trim();
const esc = (value: string) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const money = (value: number, currency = 'INR') => {
  const c = String(currency || 'INR').replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || 'INR';
  const amount = Number(value || 0);
  return c === 'INR' ? 'Rs. ' + amount.toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2}) : c + ' ' + amount.toFixed(2);
};
const wrap = (v: unknown, max=84) => {
  const words=ascii(v).split(/\s+/).filter(Boolean); const out:string[]=[]; let line='';
  for(const word of words){if(!line) line=word.slice(0,max); else if(line.length+1+word.length<=max) line+=' '+word; else {out.push(line);line=word.slice(0,max);}}
  if(line)out.push(line); return out.length?out:[''];
};
const textCmd=(x:number,y:number,v:unknown,size=10,bold=false)=>`BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${esc(ascii(v))}) Tj ET`;
const lineCmd=(x1:number,y1:number,x2:number,y2:number)=>`0.78 0.80 0.84 RG 0.7 w ${x1} ${y1} m ${x2} ${y2} l S`;
const addressParts=(value:unknown):string[]=>{if(!value)return[];if(typeof value==='string')return value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);if(typeof value!=='object')return[ascii(value)];const a=value as Record<string,unknown>;return[a.line1||a.address_line1||a.street,a.line2||a.address_line2,[a.city,a.state,a.postal_code||a.pin||a.pincode].filter(Boolean).join(', '),a.country].map(ascii).filter(Boolean);};

export function buildPublicDocumentPdf(doc:PublicDocument):Buffer{
  const width=595,height=842,left=42,right=42,bottom=46;
  const pages:string[][]=[[]];let pageIndex=0;let y=800;
  const current=()=>pages[pageIndex];
  const addPage=()=>{pages.push([]);pageIndex++;y=800;current().push(textCmd(left,y,doc.business.name,14,true));y-=22;current().push(textCmd(left,y,`${doc.type.toUpperCase()} ${doc.number} (continued)`,10,true));y-=18;current().push(lineCmd(left,y,width-right,y));y-=18;};
  const addLine=(value:unknown,size=10,bold=false,indent=0)=>{for(const item of wrap(value,Math.max(24,86-Math.floor(indent/4)))){if(y<bottom+24)addPage();current().push(textCmd(left+indent,y,item,size,bold));y-=size>=13?20:14;}};
  const rule=()=>{if(y<bottom+24)addPage();current().push(lineCmd(left,y,width-right,y));y-=16;};
  addLine(doc.business.name,18,true);
  if(doc.business.legalName&&doc.business.legalName!==doc.business.name)addLine(doc.business.legalName,9);
  for(const a of addressParts(doc.business.address))addLine(a,9);
  const contact=[doc.business.phone,doc.business.email,doc.business.website].filter(Boolean).join(' | ');if(contact)addLine(contact,9);
  if(doc.business.taxRegistrationNumber)addLine('GSTIN / Tax ID: '+doc.business.taxRegistrationNumber,9);
  y-=4;rule();
  addLine(doc.type==='invoice'?'TAX INVOICE':doc.type==='quotation'?'QUOTATION':doc.type==='challan'?'DELIVERY CHALLAN':'PAYMENT RECEIPT',15,true);
  addLine('Document Number: '+doc.number,10,true);
  addLine('Date: '+doc.date+(doc.dueDate?' | Due: '+doc.dueDate:''),9);
  if(doc.validUntil)addLine('Valid until: '+doc.validUntil,9);
  addLine('Status: '+doc.status.replace(/_/g,' '),9);
  y-=4;rule();
  addLine(doc.type==='challan'?'CONSIGNEE':'BILL TO',9,true);
  addLine(doc.customer.legalName||doc.customer.name,11,true);
  for(const a of addressParts(doc.customer.address))addLine(a,9);
  if(doc.customer.phone)addLine(doc.customer.phone,9);if(doc.customer.email)addLine(doc.customer.email,9);
  if(doc.customer.taxId)addLine('Customer Tax ID: '+doc.customer.taxId,9);
  y-=4;rule();addLine('ITEM / DESCRIPTION',9,true);
  for(const item of doc.items){addLine(item.description+(item.hsnSac?' (HSN/SAC '+item.hsnSac+')':''),9,true);addLine('Qty: '+item.quantity+(item.unit?' '+item.unit:'')+' | Rate: '+money(item.unitPrice,doc.currencyCode)+' | Amount: '+money(item.lineTotal,doc.currencyCode),9,false,12);y-=3;}
  y-=2;rule();
  if(doc.type!=='challan'){addLine('Subtotal: '+money(doc.subtotal,doc.currencyCode),10);if(doc.discountTotal)addLine('Discount: -'+money(doc.discountTotal,doc.currencyCode),10);if(doc.taxTotal)addLine('Tax / GST: '+money(doc.taxTotal,doc.currencyCode),10);addLine('TOTAL: '+money(doc.total,doc.currencyCode),13,true);if(doc.type==='invoice'){addLine('Amount paid: '+money(doc.amountPaid,doc.currencyCode),10);addLine('BALANCE DUE: '+money(doc.balanceDue,doc.currencyCode),13,true);}}
  else {addLine('Declared value: '+money(doc.total,doc.currencyCode),12,true);if(doc.vehicleNumber)addLine('Vehicle number: '+doc.vehicleNumber,9);if(doc.transporterName)addLine('Transporter: '+doc.transporterName,9);if(doc.ewayBillNumber)addLine('E-Way Bill: '+doc.ewayBillNumber,9);addLine('Supply on Approval / Job Work / Exhibition / Transportation Only - Not for Sale / Not a Tax Invoice',9,true);}
  if(doc.notes){y-=5;addLine('Notes: '+doc.notes,9);}if(doc.terms){y-=3;addLine('Terms and conditions: '+doc.terms,9);}
  y-=8;rule();addLine('Sent securely via Moneymatters FinOps | https://mm.nilanga.in',8);

  const objects:string[]=[];const add=(value:string)=>{objects.push(value);return objects.length;};
  const catalog=add(''),kids=add(''),regular=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');const pageIds:number[]=[];
  pages.forEach(cmds=>{const stream=Buffer.from(cmds.join('\n')+'\n','ascii');const pageId=add('');const streamId=add('');pageIds.push(pageId);objects[pageId-1]=`<< /Type /Page /Parent ${kids} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${streamId} 0 R >>`;objects[streamId-1]=`<< /Length ${stream.length} >>\nstream\n${stream.toString('latin1')}\nendstream`;});
  objects[catalog-1]=`<< /Type /Catalog /Pages ${kids} 0 R >>`;objects[kids-1]=`<< /Type /Pages /Kids [${pageIds.map(id=>id+' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
  const chunks=['%PDF-1.4\n%Moneymatters\n'];const offsets=[0];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(chunks.join(''),'ascii'));chunks.push(`${i+1} 0 obj\n${obj}\nendobj\n`);});const xref=Buffer.byteLength(chunks.join(''),'ascii');chunks.push(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`);for(let i=1;i<offsets.length;i++)chunks.push(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);chunks.push(`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);return Buffer.from(chunks.join(''),'ascii');
}
