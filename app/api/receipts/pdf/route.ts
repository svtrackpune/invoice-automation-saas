import { NextRequest } from 'next/server';
import { getServerSupabase, loadReceiptPdfData, sha256Hex, buildReceiptPdf } from '@/lib/server/receipt-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim();
  if (!token || token.length < 32) return new Response('Invalid receipt access token.', { status: 400 });

  try {
    const db = getServerSupabase();
    const tokenHash = sha256Hex(token);
    const { data: access, error } = await db.from('receipt_access_tokens')
      .select('id,receipt_id,purpose,expires_at,revoked_at')
      .eq('token_hash', tokenHash)
      .eq('purpose', 'whatsapp_delivery')
      .maybeSingle();

    const { data: downloadAccess } = !access && !error
      ? await db.from('receipt_access_tokens')
          .select('id,receipt_id,purpose,expires_at,revoked_at')
          .eq('token_hash', tokenHash)
          .eq('purpose', 'customer_download')
          .maybeSingle()
      : { data: null };

    const resolved = access || downloadAccess;
    if (!resolved || resolved.revoked_at) return new Response('Receipt link is invalid.', { status: 404 });
    if (resolved.expires_at && new Date(resolved.expires_at).getTime() <= Date.now()) {
      return new Response('Receipt link has expired.', { status: 410 });
    }

    const data = await loadReceiptPdfData(db, resolved.receipt_id);
    const pdf = buildReceiptPdf(data);
    const safeNumber = String(data.receipt.receipt_number || data.receipt.id).replace(/[^a-zA-Z0-9._-]+/g, '-');

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="receipt-${safeNumber}.pdf"`,
        'Cache-Control': 'private, max-age=300, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Unable to prepare receipt PDF.', { status: 500 });
  }
}
