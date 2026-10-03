import type { TenantNotificationConnection } from '../connection-resolver';

export type WapiMessage = {
  recipient: string;
  message: string;
  actionUrl?: string | null;
};

export async function sendWapiMessage(
  connection: TenantNotificationConnection,
  payload: WapiMessage,
  publicAppUrl: string,
): Promise<string | null> {
  if (connection.provider !== 'wapi') throw new Error('Invalid Wapi notification provider.');
  if (!connection.secret) throw new Error('Wapi credential is unavailable.');
  if (!connection.endpoint_url) throw new Error('Wapi endpoint is not configured.');

  const endpoint = connection.endpoint_url.replace(/\/+$/, '') + '/message/sendText';
  const body = payload.actionUrl
    ? payload.message + '\n\n' + publicAppUrl.replace(/\/+$/, '') + (payload.actionUrl.startsWith('/') ? payload.actionUrl : '/' + payload.actionUrl)
    : payload.message;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + connection.secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: payload.recipient, text: body }),
  });

  if (!response.ok) throw new Error('Wapi delivery failed.');
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== 'object') return null;
  const id = (data as Record<string, unknown>).message_id ?? (data as Record<string, unknown>).id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}