import { NextRequest } from 'next/server';
import { getServerSupabase, loadReceiptPdfData, sha256Hex, buildReceiptPdf } from '@/lib/server/receipt-pdf';
import { withErrorHandler, NotFoundError, ValidationError } from '@/lib/server/errors';
import { receiptAccessQuerySchema } from '@/lib/validations/receipt';
import { checkRateLimit, getClientRateLimitKey } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const slug = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'receipt';

const RECEIPT_RATE_LIMIT = 30;
const RECEIPT_RATE_WINDOW_MS = 60_000;

export async function GET(request: NextRequest) {
  return withErrorHandler(request, async (req, requestId) => {
    const rateLimit = checkRateLimit(
      getClientRateLimitKey(req, 'receipt-pdf'),
      RECEIPT_RATE_LIMIT,
      RECEIPT_RATE_WINDOW_MS,
    );

    if (!rateLimit.allowed) {
      return Response.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many receipt requests. Please try again later.',
            details: [],
            requestId,
          },
        },
        {
          status: 429,
          headers: {
            'Cache-Control': 'no-store',
            'Retry-After': String(rateLimit.retryAfterSeconds),
            'X-RateLimit-Limit': String(rateLimit.limit),
            'X-RateLimit-Remaining': String(rateLimit.remaining),
          },
        },
      );
    }

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
      throw new NotFoundError('Receipt link is invalid.');
    }

    if (access.expires_at && new Date(access.expires_at).getTime() <= Date.now()) {
      throw new NotFoundError('Receipt link is invalid or has expired.');
    }

    const data = await loadReceiptPdfData(db, access.receipt_id);
    const pdf = buildReceiptPdf(data);
    const entitySlug = slug(data.business?.name || data.business?.legal_name || data.customer?.display_name || 'entity');
    const rawNumber = String(data.receipt.receipt_number || data.receipt.id).replace(/^(?:REC(?:EIPT)?|RCPT|RCT)[-_ ]*/i, '');
    const numberSlug = slug(rawNumber || String(data.receipt.receipt_number || data.receipt.id));
    const filename = `${entitySlug}-receipt-${numberSlug}.pdf`;

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'X-RateLimit-Limit': String(rateLimit.limit),
        'X-RateLimit-Remaining': String(rateLimit.remaining),
      },
    });
  });
}
