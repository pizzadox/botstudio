import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { snapshot } from '@/lib/metrics';

/**
 * Health-check (22-BE2, IMP-BE22-08). Без авторизации — доступен мониторингу.
 * GET /api/health → { ok, uptime, db, ts, metrics }
 */
export async function GET() {
  let dbStatus: 'up' | 'down' = 'down';
  try {
    await db.$queryRaw`SELECT 1`;
    dbStatus = 'up';
  } catch {
    dbStatus = 'down';
  }

  return NextResponse.json(
    {
      ok: dbStatus === 'up',
      uptime: process.uptime(),
      db: dbStatus,
      ts: new Date().toISOString(),
      metrics: snapshot(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
