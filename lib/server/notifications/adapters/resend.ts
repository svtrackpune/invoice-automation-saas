import type { TenantNotificationConnection } from '../connection-resolver';

export async function sendResendMessage(
  connection: TenantNotificationConnection,
  recipient: string,
  subject: string,
  message: string,
  actionUrl: string | null,
  idempotencyKey: string,
): Promise<string | null> {
  if (connection.provider !== 'resend') throw new Error('Invalid Resend notification provider.');
  if (!connection.secret || !connection.sender) throw new Error('Email connection is incomplete.');

  const endpoint = connection.endpoint_url?.replace(/\/+$/, '') || 'https://api.resend.com';
  const response = await fetch(endpoint + '/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + connection.secret,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: connection.sender,
      to: [recipient],
      subject,
      text: actionUrl ? message + '\n\n' + actionUrl : message,
    }),
  });

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== 'object') throw new Error('Email delivery failed.');
  const id = (data as Record<string, unknown>).id;
  return typeof id === 'string' ? id : null;
}