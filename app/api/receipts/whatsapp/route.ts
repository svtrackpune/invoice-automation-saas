import { NextRequest } from 'next/server';
import { getServerSupabase, loadReceiptPdfData, sha256Hex } from '@/lib/server/receipt-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const countryDialCodes: Record<string, string> = {
  IN: '91',
  AE: '971',
  AU: '61',
  BD: '880',
  CA: '1',
  GB: '44',
  NP: '977',
  NZ: '64',
  SG: '65',
  US: '1',
};

const normalizeWhatsAppPhone = (value: string, countryCode: string | null | undefined) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  const dialCode = countryDialCodes[String(countryCode || 'IN').toUpperCase()] || '91';
  if (digits.length === 10) digits = dialCode + digits;
  if (digits.length < 8 || digits.length > 15) throw new Error('Customer mobile number is not a valid WhatsApp destination.');
  return digits;
};

const updateAttempt = async (
  db: ReturnType<typeof getServerSupabase>,
  id: string,
  patch: Record<string, unknown>,
) => {
  await db.from('receipt_delivery_attempts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
};

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, status: 'failed', message: 'Invalid request.' }, { status: 400 });
  }

  const token = String(body?.token || '').trim();
  if (!token || token.length < 32) {
    return Response.json({ ok: false, status: 'failed', message: 'Invalid delivery token.' }, { status: 400 });
  }

  const db = getServerSupabase();
  const tokenHash = sha256Hex(token);
  const { data: access, error: accessError } = await db
    .from('receipt_access_tokens')
    .select('id,receipt_id,purpose,expires_at,revoked_at')
    .eq('token_hash', tokenHash)
    .eq('purpose', 'whatsapp_delivery')
    .maybeSingle();

  if (accessError || !access || access.revoked_at) {
    return Response.json({ ok: false, status: 'failed', message: 'WhatsApp delivery token is invalid.' }, { status: 404 });
  }

  if (access.expires_at && new Date(access.expires_at).getTime() <= Date.now()) {
    return Response.json({ ok: false, status: 'failed', message: 'WhatsApp delivery token has expired. Please prepare a new send.' }, { status: 410 });
  }

  const { data: attempt, error: attemptError } = await db
    .from('receipt_delivery_attempts')
    .select('id,receipt_id,status,attempt_count,provider_message_id')
    .eq('id', body?.deliveryId || '')
    .eq('receipt_id', access.receipt_id)
    .eq('channel', 'whatsapp')
    .maybeSingle();

  if (attemptError || !attempt) {
    return Response.json({ ok: false, status: 'failed', message: 'WhatsApp delivery attempt could not be found.' }, { status: 404 });
  }

  if (attempt.status === 'submitted' || attempt.status === 'delivered') {
    return Response.json({ ok: true, status: attempt.status, messageId: attempt.provider_message_id });
  }

  try {
    const data = await loadReceiptPdfData(db, access.receipt_id);
    const customerPhone = data.customer?.phone?.trim() || '';
    if (!customerPhone) {
      await updateAttempt(db, attempt.id, { status: 'failed', error_message: 'Customer mobile number is blank.' });
      return Response.json({ ok: false, status: 'failed', message: 'Customer has no mobile number. Use the digital receipt QR/link instead.' }, { status: 422 });
    }

    const { data: business, error: businessError } = await db
      .from('businesses')
      .select('country_code')
      .eq('id', data.receipt.business_id)
      .single();
    if (businessError || !business) throw new Error('Business country configuration could not be loaded.');

    const recipient = normalizeWhatsAppPhone(customerPhone, business.country_code);
    const accessBase = (process.env.MONEYMATTERS_PUBLIC_URL || request.nextUrl.origin).replace(/\/$/, '');
    const pdfUrl = `${accessBase}/api/receipts/pdf?token=${encodeURIComponent(token)}`;
    const filename = `receipt-${String(data.receipt.receipt_number || access.receipt_id).replace(/[^a-zA-Z0-9._-]+/g, '-')}.pdf`;
    const mode = String(process.env.WHATSAPP_RECEIPT_SEND_MODE || 'document').toLowerCase();

    const accessToken = process.env.WHATSAPP_CLOUD_API_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION || 'v23.0';
    if (!accessToken || !phoneNumberId) {
      await updateAttempt(db, attempt.id, { status: 'failed', error_message: 'WhatsApp Cloud API credentials are not configured.' });
      return Response.json({ ok: false, status: 'failed', message: 'WhatsApp delivery is not configured on this server.' }, { status: 503 });
    }

    const endpoint = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
    const businessName = data.business?.name || data.business?.legal_name || 'Business';
    const caption = `${businessName} · Payment receipt ${data.receipt.receipt_number}`;
    const payload = mode === 'template'
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'template',
          template: {
            name: process.env.WHATSAPP_RECEIPT_TEMPLATE_NAME || 'receipt_document',
            language: { code: process.env.WHATSAPP_RECEIPT_TEMPLATE_LANGUAGE || 'en_US' },
            components: [{
              type: 'header',
              parameters: [{
                type: 'document',
                document: { link: pdfUrl, filename },
              }],
            }],
          },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'document',
          document: {
            link: pdfUrl,
            caption,
            filename,
          },
        };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerMessage = result?.error?.message || `WhatsApp API returned HTTP ${response.status}.`;
      await updateAttempt(db, attempt.id, {
        status: 'failed',
        attempt_count: Number(attempt.attempt_count || 0) + 1,
        error_message: providerMessage.slice(0, 1000),
      });
      return Response.json({ ok: false, status: 'failed', message: providerMessage }, { status: 502 });
    }

    const messageId = result?.messages?.[0]?.id || null;
    if (!messageId) {
      await updateAttempt(db, attempt.id, {
        status: 'failed',
        attempt_count: Number(attempt.attempt_count || 0) + 1,
        error_message: 'WhatsApp API accepted the request without returning a message ID.',
      });
      return Response.json({ ok: false, status: 'failed', message: 'WhatsApp provider did not return a message ID.' }, { status: 502 });
    }

    await updateAttempt(db, attempt.id, {
      status: 'submitted',
      attempt_count: Number(attempt.attempt_count || 0) + 1,
      provider_message_id: messageId,
      error_message: null,
      submitted_at: new Date().toISOString(),
    });

    return Response.json({
      ok: true,
      status: 'submitted',
      messageId,
      receiptNumber: data.receipt.receipt_number,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send the WhatsApp receipt.';
    await updateAttempt(db, attempt.id, {
      status: 'failed',
      attempt_count: Number(attempt.attempt_count || 0) + 1,
      error_message: message.slice(0, 1000),
    });
    return Response.json({ ok: false, status: 'failed', message }, { status: 500 });
  }
}
