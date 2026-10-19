import { NextRequest, NextResponse } from 'next/server';
import { resolveSupportedLocale } from '@/lib/i18n';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        return NextResponse.json({ error: 'Cross-origin locale update is not allowed.' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
    }
  }

  let payload: { locale?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'A locale value is required.' }, { status: 400 });
  }

  const locale = resolveSupportedLocale(typeof payload.locale === 'string' ? payload.locale : null);
  if (!locale) {
    return NextResponse.json({ error: 'Unsupported locale.' }, { status: 400 });
  }

  const response = NextResponse.json({ locale });
  response.cookies.set({
    name: 'NEXT_LOCALE',
    value: locale.split('-')[0],
    path: '/',
    maxAge: 31536000,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}
