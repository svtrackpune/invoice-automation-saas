import { NextRequest, NextResponse } from 'next/server';
import { renderDocumentToBuffer, resolvePublicDocumentByToken, type PublicDocumentType } from '@/lib/server/documents/public-tokens';
import { buildDocumentDownloadFilename, documentFilenameLabel } from '@/lib/shared/document-filename';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allowed = new Set<PublicDocumentType>(['invoice','quotation','challan','receipt']);

export function buildDownloadFilename(type: string, entityName: string, docNumber: string): string {
  return buildDocumentDownloadFilename(entityName, documentFilenameLabel(type), docNumber);
}
export async function GET(request: NextRequest) {
  const requestedType = (request.nextUrl.searchParams.get('type') || '').trim().toLowerCase();
  const type = (requestedType === 'quote' ? 'quotation' : requestedType) as PublicDocumentType | null;
  const token = request.nextUrl.searchParams.get('token') || '';
  if (!type || !allowed.has(type) || !token) return NextResponse.json({error:'Document not found.'},{status:404,headers:{'Cache-Control':'private, no-store'}});
  try {
    const document = await resolvePublicDocumentByToken(type, token);
    if (!document) return NextResponse.json({error:'Document not found or link expired.'},{status:404,headers:{'Cache-Control':'private, no-store'}});
    const pdf = await renderDocumentToBuffer(type, document.id, document.businessId);
    const filename = buildDownloadFilename(type, document.business.name || document.customer.name || 'Business', document.number || document.id);
    return new NextResponse(new Uint8Array(pdf),{status:200,headers:{
      'Content-Type':'application/pdf',
      'Content-Disposition':`attachment; filename="${filename}"`,
      'Cache-Control':'private, no-store, max-age=0',
      'X-Content-Type-Options':'nosniff',
      'X-Robots-Tag':'noindex, nofollow, noarchive'
    }});
  } catch {
    return NextResponse.json({error:'Document PDF is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
  }
}
