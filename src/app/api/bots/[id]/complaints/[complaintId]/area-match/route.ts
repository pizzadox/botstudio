import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { matchAreasFor } from '@/lib/area-match';

/**
 * IMP-24-BE-16: кандидаты КП реестра для жалобы — совпадение по координатам
 * (haversine ≤ radiusM) и/или по адресу (пересечение значимых токенов).
 * Опционально: ?limit=1..20 (деф 5), ?radius=м (деф 250).
 * Ответ: { candidates: AreaMatchCandidate[] } (контракт studio-types).
 */

type Params = { params: Promise<{ id: string; complaintId: string }> };

export async function GET(req: NextRequest, ctx: Params) {
  // IMP-29-B2: обёртка try/catch — сбой БД/матчера отдаёт JSON 500 вместо plain-text
  try {
    return await complaintAreaMatch(req, ctx);
  } catch (err) {
    console.error('[area-match complaint]', err);
    return NextResponse.json({ error: 'Не удалось подобрать КП' }, { status: 500 });
  }
}

async function complaintAreaMatch(req: NextRequest, { params }: Params) {
  const { id, complaintId } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }
  const complaint = await db.complaint.findFirst({ where: { id: complaintId, botId: id } });
  if (!complaint) {
    return NextResponse.json({ error: 'Жалоба не найдена' }, { status: 404 });
  }

  const sp = req.nextUrl.searchParams;
  const limitParam = Number(sp.get('limit') ?? '');
  const radiusParam = Number(sp.get('radius') ?? '');

  const candidates = await matchAreasFor(
    id,
    { lat: complaint.lat, lng: complaint.lng, address: complaint.address },
    {
      ...(Number.isFinite(limitParam) && limitParam > 0 ? { limit: Math.floor(limitParam) } : {}),
      ...(Number.isFinite(radiusParam) && radiusParam > 0 ? { radiusM: radiusParam } : {}),
    }
  );

  const res = NextResponse.json({ candidates });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
