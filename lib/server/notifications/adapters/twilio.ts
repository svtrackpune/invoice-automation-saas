import type { TenantNotificationConnection } from '../connection-resolver';

export async function sendTwilioMessage(
  connection: TenantNotificationConnection,
  recipient: string,
  message: string,
  actionUrl: string | null,
): Promise<string | null> {
  if (connection.provider !== 'twilio') throw new Error('Invalid Twilio notification provider.');
  if (!connection.secret || !connection.sender) throw new Error('SMS connection is incomplete.');

  const accountSid = connection.config.account_sid;
  if (typeof accountSid !== 'string' || !accountSid) {
    throw new Error('Twilio account SID is not configured.');
  }

  const body = new URLSearchParams({
    To: recipient,
    From: connection.sender,
    Body: actionUrl ? message + ' ' + actionUrl : message,
  });

  const response = await fetch(
    'https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(accountSid) + '/Messages.json',
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(accountSid + ':' + connection.secret),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== 'object') {
    throw new Error('SMS delivery failed.');
  }

  const sid = (data as Record<string, unknown>).sid;
  return typeof sid === 'string' ? sid : null;
}