import { createHash } from 'node:crypto';
import type { CanonicalInvoice } from '../canonical';

const ICC_BASE64="AAABmmxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5k63cfPKpTUQLpPihskUauVwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfd3RwdAAAAQwAAAAUclhZWgAAASAAAAAUZ1hZWgAAATQAAAAUYlhZWgAAAUgAAAAUclRSQwAAAVwAAAA0Z1RSQwAAAVwAAAA0YlRSQwAAAVwAAAA0Y3BydAAAAZAAAAAKZGVzYwAAAAAAAAAFblJHQgAAAAAAAAAAAAAAAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAAUAAABBwK1BWsJNg5QFLEcgCXIMKE9GUtAWyds24BrleOtUMbC4jH//3RleHQAAAAAMAA=";

const GLYPHS:Record<string,string[]>={A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['11111','00100','00100','00100','00100','00100','11111'],J:['00001','00001','00001','00001','10001','10001','01110'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','11011','10001'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'],'0':['01110','10001','10011','10101','11001','10001','01110'],'1':['00100','01100','00100','00100','00100','00100','01110'],'2':['01110','10001','00001','00010','00100','01000','11111'],'3':['11110','00001','00001','01110','00001','00001','11110'],'4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','10000','11110','00001','00001','11110'],'6':['01110','10000','10000','11110','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],'8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00001','01110'],'-':['00000','00000','00000','11111','00000','00000','00000'],'.':['00000','00000','00000','00000','00000','00110','00110'],':':['00000','00110','00110','00000','00110','00110','00000'],'/':['00001','00010','00100','00100','01000','10000','00000'],'#':['01010','11111','01010','01010','11111','01010','00000'],'%':['11001','11010','00100','01011','10011','00000','00000'],',':['00000','00000','00000','00000','00110','00110','00100'],'(':['00010','00100','01000','01000','01000','00100','00010'],')':['01000','00100','00010','00010','00010','00100','01000'],' ' :['00000','00000','00000','00000','00000','00000','00000'],'?':['01110','00001','00010','00100','00100','00000','00100']};
const safe=(v:unknown)=>String(v??'').normalize('NFKD').replace(/[^\x20-\x7E]/g,'?').toUpperCase();
const escName=(v:string)=>v.replace(/[^A-Za-z0-9._-]/g,'_');
function escPdf(v:string){return v.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}
function drawText(cmds:string[],x:number,y:number,text:string,scale=2){let cx=x; for(const ch of safe(text)){const g=GLYPHS[ch]||GLYPHS['?']; for(let r=0;r<7;r++)for(let c=0;c<5;c++)if(g[r][c]==='1')cmds.push(`${(cx+c*scale).toFixed(2)} ${(y-r*scale).toFixed(2)} ${scale.toFixed(2)} ${scale.toFixed(2)} re f`); cx+=6*scale;}}

const addObj=(objects:string[],s:string)=>{objects.push(s);return objects.length;};
function streamObj(stream:Buffer,extra=''){return `<< /Length ${stream.length} ${extra} >>\nstream\n${stream.toString('latin1')}\nendstream`;}

export function buildFacturXPdfA3(inv:CanonicalInvoice,ciiXml:string):Buffer{
  const pageW=595,pageH=842,cmds:string[]=[];
  cmds.push('0.15 0.15 0.15 rg');
  drawText(cmds,42,800,inv.supplier.name,3); drawText(cmds,42,776,`INVOICE ${inv.number}`,2.5);
  drawText(cmds,42,748,`DATE ${inv.issueDate}`,2); drawText(cmds,380,748,`CURRENCY ${inv.currencyCode}`,2);
  drawText(cmds,42,715,`BILL TO ${inv.customer.name}`,2.2);
  let y=680; drawText(cmds,42,y,'DESCRIPTION',2); drawText(cmds,360,y,'QTY',2); drawText(cmds,440,y,'AMOUNT',2); y-=20;
  for(const line of inv.lines.slice(0,28)){drawText(cmds,42,y,line.description,1.5);drawText(cmds,360,y,String(line.quantity),1.5);drawText(cmds,440,y,line.lineTotal.toFixed(2),1.5);y-=16;}
  y-=8; drawText(cmds,350,y,`SUBTOTAL ${inv.subtotal.toFixed(2)}`,1.8);y-=15;drawText(cmds,350,y,`TAX ${inv.taxTotal.toFixed(2)}`,1.8);y-=15;drawText(cmds,350,y,`TOTAL ${inv.total.toFixed(2)}`,2.2);y-=18;drawText(cmds,350,y,`DUE ${inv.balanceDue.toFixed(2)}`,1.8);
  const content=Buffer.from(cmds.join('\n')+'\n','ascii');
  const cii=Buffer.from(ciiXml,'utf8');
  const icc=Buffer.from(ICC_BASE64,'base64');
  if(icc.length<400) throw new Error('Embedded sRGB ICC profile is incomplete.');
  const xmp=`<?xpacket begin="\\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#" rdf:about=""><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Invoice ${escPdf(inv.number)}</rdf:li></rdf:Alt></dc:title><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const objects:string[]=[]; const catalog=addObj(objects,''); const pages=addObj(objects,''); const resources=addObj(objects,'<< /ProcSet [/PDF] >>');
  const contentId=addObj(objects,streamObj(content));
  const iccId=addObj(objects,`<< /N 3 /Alternate /DeviceRGB /Length ${icc.length} >>\nstream\n${icc.toString('latin1')}\nendstream`);
  const outputId=addObj(objects,`<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) /Info (sRGB IEC61966-2.1) /DestOutputProfile ${iccId} 0 R >>`);
  const xmpId=addObj(objects,streamObj(Buffer.from(xmp,'utf8'),'/Subtype /XML /Type /Metadata'));
  const efId=addObj(objects,streamObj(cii,'/Type /EmbeddedFile /Subtype /application#2Fxml'));
  const fsId=addObj(objects,`<< /Type /Filespec /F (factur-x.xml) /UF (factur-x.xml) /AFRelationship /Alternative /EF << /F ${efId} 0 R /UF ${efId} 0 R >> >>`);
  const namesId=addObj(objects,`<< /EmbeddedFiles << /Names [(factur-x.xml) ${fsId} 0 R] >> >>`);
  const pageId=addObj(objects,`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources ${resources} 0 R /Contents ${contentId} 0 R >>`);
  objects[resources-1]='<< /ProcSet [/PDF] >>';
  objects[pages-1]=`<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`;
  objects[catalog-1]=`<< /Type /Catalog /Pages ${pages} 0 R /Metadata ${xmpId} 0 R /OutputIntents [${outputId} 0 R] /Names ${namesId} 0 R /AF [${fsId} 0 R] /Lang (en-US) /ViewerPreferences << /DisplayDocTitle true >> >>`;
  const chunks=['%PDF-1.7\n%Moneymatters PDF/A-3\n']; const offsets=[0]; let offset=Buffer.byteLength(chunks[0],'latin1');
  objects.forEach((o,i)=>{offsets[i+1]=offset;const body=`${i+1} 0 obj\n${o}\nendobj\n`;chunks.push(body);offset+=Buffer.byteLength(body,'latin1');});
  const xref=offset; chunks.push(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`);for(let i=1;i<=objects.length;i++)chunks.push(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);chunks.push(`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R /Info << /Title (Invoice ${escPdf(inv.number)}) /Producer (Moneymatters) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.from(chunks.join(''),'latin1');
}