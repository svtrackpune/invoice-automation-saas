import { NextRequest } from 'next/server';
import { getServerSupabase, loadReceiptPdfData, sha256Hex, buildReceiptPdf } from '@/lib/server/receipt-pdf';
import { withErrorHandler, ValidationError } from '@/lib/server/errors';
import { receiptAccessQuerySchema } from '@/lib/validations/receipt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return withErrorHandler(request, async (req) => {
    const result = receiptAccessQuerySchema.safeParse({
      token: req.nextUrl.searchParams.get('token') ?? undefined,
    });

    if (!result.success) {
      throw ValidationError.fromZodIssues(result.error.issues);
    }

    const db = getServerSupabase();
    const tokenHash = sha256Hex(result.data.token);
    const { data: access, error: accessError } = await db
      .from('receipt_access_tokens')
      .select('id,receipt_id,purpose,expires_at,revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (accessError) {
      throw accessError;
    }

    if (!access || access.revoked_at) {
      return new Response('Receipt link is invalid.', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
    }

    if (access.expires_at && new Date(access.expires_at).getTime() <= Date.now()) {
      return new Response('Receipt link is invalid or has expired.', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
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
  });
}
