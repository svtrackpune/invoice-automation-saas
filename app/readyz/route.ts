import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/server/receipt-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const db = getServerSupabase();
    const { error } = await db.from('businesses').select('id').limit(1);

    if (error) {
      console.error(JSON.stringify({
        event: 'readiness_database_check_failed',
        name: error.name,
        code: error.code,
      }));
      return NextResponse.json(
        { status: 'unhealthy', database: 'disconnected' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { status: 'ready', database: 'connected' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: 'readiness_check_failed',
      name: error instanceof Error ? error.name : 'UnknownError',
    }));

    return NextResponse.json(
      { status: 'unhealthy', database: 'disconnected' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
