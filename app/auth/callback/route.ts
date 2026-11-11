import { NextResponse } from 'next/server';

const DEFAULT_NEXT = '/next-workspace';
const PRODUCTION_APP_ORIGIN = 'https://mm.nilanga.in';
const OAUTH_ERRORS = new Set(['access_denied', 'server_error', 'validation_failed']);

function getPublicAppOrigin(requestUrl: URL): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const candidate = configured || (process.env.NODE_ENV === 'production' ? PRODUCTION_APP_ORIGIN : requestUrl.origin);

  try {
    const parsed = new URL(candidate);
    const isLocalHttp = process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:';
    if (parsed.protocol !== 'https:' && !isLocalHttp) return PRODUCTION_APP_ORIGIN;
    return parsed.origin;
  } catch {
    return PRODUCTION_APP_ORIGIN;
  }
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return DEFAULT_NEXT;
  try {
    const parsed = new URL(value, 'https://local.invalid');
    return parsed.origin === 'https://local.invalid' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : DEFAULT_NEXT;
  } catch {
    return DEFAULT_NEXT;
  }
}

/**
 * Keep the OAuth PKCE code verifier in the existing browser Supabase client.
 * This route relays the authorization code to the app root, where that same
 * client (detectSessionInUrl: true) exchanges it and establishes the session.
 * Do not exchange the code in this server route: the verifier is in browser
 * storage, not in server cookies in the current app authentication architecture.
 */
export function GET(request: Request) {
  const incoming = new URL(request.url);
  // Plesk/IIS may expose the internal listener as the request origin. Never
  // send the user's browser to 0.0.0.0:3000; use the configured public origin.
  const target = new URL('/', getPublicAppOrigin(incoming));
  const code = incoming.searchParams.get('code');
  const next = safeNext(incoming.searchParams.get('next'));

  if (code) {
    target.searchParams.set('code', code);
    target.searchParams.set('oauth_next', next);
    return NextResponse.redirect(target);
  }

  const providerError = incoming.searchParams.get('error');
  const errorCode = incoming.searchParams.get('error_code');
  const description = incoming.searchParams.get('error_description');
  target.searchParams.set('auth_error', 'oauth_exchange_failed');
  const message = description || (providerError && OAUTH_ERRORS.has(providerError) ? providerError : '') || errorCode || 'Social sign-in could not be completed.';
  target.searchParams.set('auth_message', message.slice(0, 240));
  return NextResponse.redirect(target);
}
