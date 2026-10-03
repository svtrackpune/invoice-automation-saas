import { NextResponse } from 'next/server';
import { canonicalFromAdmin } from '@/lib/server/documents/canonical';
import { serializePeppolUblInvoice, validatePeppolXml } from '@/lib/server/documents/ubl/serialize';
import { authenticatePublicApi } from '@/lib/server/api-key-auth';
export const runtime='nodejs';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  try{const key=await authenticatePublicApi(req,'invoices:read');const {id}=await params;const invoice=await canonicalFromAdmin(id);if(invoice.businessId!==key.businessId)return NextResponse.json({error:'Invoice not found'},{status:404});const xml=validatePeppolXml(serializePeppolUblInvoice(invoice));return new NextResponse(xml,{status:200,headers:{'Content-Type':'application/xml; charset=utf-8','Content-Disposition':`attachment; filename="${invoice.number.replace(/[^A-Za-z0-9._-]/g,'_')}.xml`,'Cache-Control':'no-store'}});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'UBL export failed'},{status:422});}
}