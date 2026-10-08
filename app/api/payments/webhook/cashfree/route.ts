import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return NextResponse.json({ error: 'Payment service is not configured' }, { status: 503 });
  const url = new URL('/functions/v1/cashfree-webhook', supabaseUrl);
  url.search = new URL(request.url).search;
  const body = await request.arrayBuffer();
  const response = await fetch(url, {
    method: 'POST',
    headers: request.headers,
    body,
    cache: 'no-store',
  });
  return new NextResponse(response.body, { status: response.status, headers: response.headers });
}
