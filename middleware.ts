import { NextRequest, NextResponse } from 'next/server.js';

const API_PREFIX = '/api/';
const PUBLIC_API_PREFIX = '/api/v1/';
const SAFE_CORS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function getPublicApiCorsOrigins(): string[] {
  return (process.env.MONEYMATTERS_API_CORS_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean).flatMap((x) => {
    try { return [new URL(x).origin]; } catch { return []; }
  });
}

function getAllowedOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return null;
  try { return new URL(configured).origin; } catch { return null; }
}

function getSupabaseOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configured) return null;
  try { return new URL(configured).origin; } catch { return null; }
}

function createNonce(): string { return btoa(crypto.randomUUID()); }

function buildContentSecurityPolicy(nonce: string, supabaseOrigin: string | null): string {
  const connectSources = ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'https://mm.nilanga.in', supabaseOrigin]
    .filter((value): value is string => Boolean(value)).join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function middleware(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith(API_PREFIX);
  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigin = getAllowedOrigin();
  const requestOrigin = request.headers.get('origin');
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce, getSupabaseOrigin());
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next.js uses the incoming CSP header to discover the per-request nonce
  // and applies that nonce to its generated scripts and inline bootstrap code.
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Content-Security-Policy', csp);

  if (isProduction) response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  const isPublicApi = pathname.startsWith(PUBLIC_API_PREFIX);

  if (isPublicApi) {
    const origins = getPublicApiCorsOrigins();
    const allowed = Boolean(requestOrigin && origins.includes(requestOrigin));
    if (request.method === 'OPTIONS') {
      if (requestOrigin && !allowed) return NextResponse.json(
        { success: false, error: { code: 'CORS_FORBIDDEN', message: 'Public API origin is not allowed.' } },
        { status: 403 },
      );
      if (requestOrigin) {
        response.headers.set('Access-Control-Allow-Origin', requestOrigin);
        response.headers.set('Vary', 'Origin');
      }
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
      response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST');
      response.headers.set('Access-Control-Max-Age', '600');
      return new NextResponse(null, { status: 204, headers: response.headers });
    }
    if (requestOrigin && !allowed) return NextResponse.json(
      { success: false, error: { code: 'CORS_FORBIDDEN', message: 'Public API origin is not allowed.' } },
      { status: 403 },
    );
  } else if (isApi) {
    if (requestOrigin && allowedOrigin && requestOrigin === allowedOrigin) {
      response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
      response.headers.set('Vary', 'Origin');
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
      response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    } else if (requestOrigin && request.method !== 'OPTIONS' && !SAFE_CORS_METHODS.has(request.method)) {
      return NextResponse.json(
        { success: false, error: { code: 'CORS_FORBIDDEN', message: 'Cross-origin request is not allowed.' } },
        { status: 403 },
      );
    }

    if (request.method === 'OPTIONS') {
      if (requestOrigin && (!allowedOrigin || requestOrigin !== allowedOrigin)) {
        return NextResponse.json(
          { success: false, error: { code: 'CORS_FORBIDDEN', message: 'Cross-origin request is not allowed.' } },
          { status: 403 },
        );
      }
      return new NextResponse(null, { status: 204, headers: response.headers });
    }
  }

  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|healthz|readyz).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
