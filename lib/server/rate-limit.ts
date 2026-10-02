type Bucket = {
  count: number;
  windowStartedAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 60;
const MAX_BUCKETS = 10_000;

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStartedAt >= WINDOW_MS) {
      buckets.delete(key);
    }
  }
}

export function checkRateLimit(
  key: string,
  limit = DEFAULT_LIMIT,
  windowMs = WINDOW_MS,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (buckets.size > MAX_BUCKETS) prune(now);

  if (!existing || now - existing.windowStartedAt >= windowMs) {
    buckets.set(key, { count: 1, windowStartedAt: now });
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((existing.windowStartedAt + windowMs - now) / 1000),
  );

  if (existing.count > limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  return {
    allowed: true,
    limit,
    remaining: limit - existing.count,
    retryAfterSeconds,
  };
}

export function getClientRateLimitKey(request: Request, scope: string): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const address = forwardedFor?.split(',')[0]?.trim() || realIp?.trim() || 'unknown';
  return `${scope}:${address}`;
}
