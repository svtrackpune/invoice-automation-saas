import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/server/receipt-pdf';
import { getDatabaseReadiness } from '@/lib/server/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const jsonHeaders = { 'Cache-Control': 'no-store' };

function configurationState() {
  return {
    supabaseUrlConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
    serviceRoleKeyConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
  };
}

export async function GET(): Promise<NextResponse> {
  const config = configurationState();

  if (!config.supabaseUrlConfigured || !config.serviceRoleKeyConfigured) {
    console.error(JSON.stringify({
      event: 'readiness_configuration_missing',
      ...config,
    }));

    return NextResponse.json(
      {
        status: 'unhealthy',
        database: 'disconnected',
        error: {
          code: 'CONFIGURATION_ERROR',
          message: 'Server Supabase environment is not configured.',
          ...config,
        },
      },
      { status: 503, headers: jsonHeaders },
    );
  }

  try {
    const db = getServerSupabase();
    const result = await getDatabaseReadiness(db);

    if (result.error) {
      console.error(JSON.stringify({
        event: 'readiness_database_check_failed',
        ...result.error,
      }));

      return NextResponse.json(
        {
          status: 'unhealthy',
          database: 'disconnected',
          error: {
            code: result.error.code || 'DATABASE_QUERY_FAILED',
            name: result.error.name || 'UnknownDatabaseError',
            message: result.error.message || 'Database readiness query failed.',
            ...config,
          },
        },
        { status: 503, headers: jsonHeaders },
      );
    }

    return NextResponse.json(
      { status: 'ready', database: 'connected' },
      { status: 200, headers: jsonHeaders },
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: 'readiness_check_failed',
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    }));

    return NextResponse.json(
      {
        status: 'unhealthy',
        database: 'disconnected',
        error: {
          code: 'READINESS_CHECK_FAILED',
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...config,
        },
      },
      { status: 503, headers: jsonHeaders },
    );
  }
}
