import { NextRequest, NextResponse } from 'next/server';

const API_PREFIX = '/api/';
const SAFE_CORS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function getAllowedOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return null;

  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

function getSupabaseOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configured) return null;

  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

function createNonce(): string {
  return btoa(crypto.randomUUID());
}

function buildContentSecurityPolicy(nonce: string, supabaseOrigin: string | null): string {
  const connectSources = ["'self'", supabaseOrigin, 'https://*.supabase.co', 'wss://*.supabase.co']
    .filter((value): value is string => Boolean(value))
    .join(' ');

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function middleware(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith(API_PREFIX);
  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigin = getAllowedOrigin();
  const requestOrigin = request.headers.get('origin');
  const nonce = createNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Content-Security-Policy', buildContentSecurityPolicy(nonce, getSupabaseOrigin()));

  if (isProduction) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  if (isApi) {
    if (requestOrigin && allowedOrigin && requestOrigin === allowedOrigin) {
      response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
      response.headers.set('Vary', 'Origin');
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
      response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    } else if (requestOrigin && request.method !== 'OPTIONS') {
      if (!SAFE_CORS_METHODS.has(request.method)) {
        return NextResponse.json(
          { success: false, error: { code: 'CORS_FORBIDDEN', message: 'Cross-origin request is not allowed.' } },
          { status: 403 },
        );
      }
    }

    if (request.method === 'OPTIONS') {
      if (requestOrigin && (!allowedOrigin || requestOrigin !== allowedOrigin)) {
        return NextResponse.json(
          { success: false, error: { code: 'CORS_FORBIDDEN', message: 'Cross-origin request is not allowed.' } },
          { status: 403 },
        );
      }

      return new NextResponse(null, {
        status: 204,
        headers: response.headers,
      });
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next|favicon.ico).*)'],
};
