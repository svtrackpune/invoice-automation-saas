import type { NotificationChannel, TenantNotificationConnection } from './connection-resolver';

export const NOTIFICATION_CHANNEL_ORDER: NotificationChannel[] = [
  'whatsapp',
  'email',
  'sms',
  'telegram',
];

export type NotificationAttemptState = {
  deliveryIdempotencyKey: string;
  attemptedChannels: NotificationChannel[];
  deliveryAttempt: number;
};

export function readAttemptState(
  metadata: Record<string, unknown>,
  fallbackKey: string,
  attempts: number,
): NotificationAttemptState {
  const attemptedRaw = metadata.attempted_channels;
  const attemptedChannels = Array.isArray(attemptedRaw)
    ? attemptedRaw.filter(
        (value): value is NotificationChannel =>
          typeof value === 'string' && NOTIFICATION_CHANNEL_ORDER.includes(value as NotificationChannel),
      )
    : [];

  const key = typeof metadata.delivery_idempotency_key === 'string'
    ? metadata.delivery_idempotency_key
    : fallbackKey;

  const attempt = typeof metadata.delivery_attempt === 'number'
    ? Math.max(metadata.delivery_attempt, attempts, 1)
    : Math.max(attempts, 1);

  return {
    deliveryIdempotencyKey: key,
    attemptedChannels,
    deliveryAttempt: attempt,
  };
}

export function selectFailoverConnection(
  connections: TenantNotificationConnection[],
  state: NotificationAttemptState,
): TenantNotificationConnection | null {
  return connections
    .filter((connection) => connection.enabled && connection.health_status !== 'failing')
    .sort((a, b) => a.priority - b.priority)
    .find((connection) => !state.attemptedChannels.includes(connection.channel)) ?? null;
}

export function nextAttemptMetadata(
  state: NotificationAttemptState,
  nextConnection: TenantNotificationConnection,
) {
  return {
    delivery_idempotency_key: state.deliveryIdempotencyKey,
    idempotency_key: state.deliveryIdempotencyKey,
    delivery_attempt: state.deliveryAttempt + 1,
    attempted_channels: Array.from(
      new Set([...state.attemptedChannels, nextConnection.channel]),
    ),
    connection_id: nextConnection.id,
    provider: nextConnection.provider,
  };
}

export function shouldFailover(attempts: number, maxAttempts = 5) {
  return attempts < maxAttempts;
}