import type { TenantNotificationConnection } from '../connection-resolver';

export type TelegramMessage = {
  recipient: string;
  message: string;
  actionUrl?: string | null;
};

export async function sendTelegramMessage(
  connection: TenantNotificationConnection,
  payload: TelegramMessage,
  publicAppUrl: string,
): Promise<string | null> {
  if (connection.provider !== 'telegram-bot') throw new Error('Invalid Telegram notification provider.');
  if (!connection.secret) throw new Error('Telegram bot credential is unavailable.');

  const text = payload.actionUrl ? payload.message + '\n\nView receipt' : payload.message;
  const entities = payload.actionUrl
    ? [{
        type: 'text_link',
        offset: text.length - 'View receipt'.length,
        length: 'View receipt'.length,
        url: publicAppUrl.replace(/\/+$/, '') + (payload.actionUrl.startsWith('/') ? payload.actionUrl : '/' + payload.actionUrl),
      }]
    : undefined;

  const response = await fetch('https://api.telegram.org/bot' + connection.secret + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: payload.recipient,
      text,
      ...(entities ? { entities } : {}),
      disable_web_page_preview: true,
    }),
  });

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== 'object' || (data as Record<string, unknown>).ok !== true) {
    throw new Error('Telegram delivery failed.');
  }
  const result = (data as Record<string, unknown>).result;
  if (!result || typeof result !== 'object') return null;
  const messageId = (result as Record<string, unknown>).message_id;
  return typeof messageId === 'string' || typeof messageId === 'number' ? String(messageId) : null;
}