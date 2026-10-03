import { NextResponse } from 'next/server';
import { canonicalFromAdmin } from '@/lib/server/documents/canonical';
import { serializeFacturXCii, validateFacturXCii } from '@/lib/server/documents/factur-x/cii';
import { buildFacturXPdfA3 } from '@/lib/server/documents/factur-x/pdf-a3';
import { authenticatePublicApi } from '@/lib/server/api-key-auth';
export const runtime='nodejs';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  try{const key=await authenticatePublicApi(req,'invoices:read');const {id}=await params;const invoice=await canonicalFromAdmin(id);if(invoice.businessId!==key.businessId)return NextResponse.json({error:'Invoice not found'},{status:404});const cii=validateFacturXCii(serializeFacturXCii(invoice));const pdf=buildFacturXPdfA3(invoice,cii);return new NextResponse(pdf,{status:200,headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${invoice.number.replace(/[^A-Za-z0-9._-]/g,'_')}-factur-x.pdf`,'Cache-Control':'no-store'}});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Factur-X export failed'},{status:422});}
}