import { NextRequest } from 'next/server';
import { getServerSupabase, loadReceiptPdfData, sha256Hex, buildReceiptPdf } from '@/lib/server/receipt-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim();
  if (!token || token.length < 32) {
    return new Response('Invalid receipt access token.', { status: 400 });
  }

  try {
    const db = getServerSupabase();
    const tokenHash = sha256Hex(token);
    const { data: access, error: accessError } = await db
      .from('receipt_access_tokens')
      .select('id,receipt_id,purpose,expires_at,revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (accessError || !access || access.revoked_at) {
      return new Response('Receipt link is invalid.', { status: 404 });
    }

    if (access.expires_at && new Date(access.expires_at).getTime() <= Date.now()) {
      return new Response('Receipt link has expired.', { status: 410 });
    }

    const data = await loadReceiptPdfData(db, access.receipt_id);
    const pdf = buildReceiptPdf(data);
    const filename = `receipt-${String(data.receipt.receipt_number || data.receipt.id).replace(/[^a-zA-Z0-9._-]+/g, '-')}.pdf`;

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to prepare receipt PDF.';
    return new Response(message, { status: 500 });
  }
}
