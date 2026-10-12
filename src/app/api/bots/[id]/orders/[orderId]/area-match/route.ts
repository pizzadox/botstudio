import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { matchAreasFor } from '@/lib/area-match';

/**
 * IMP-24-BE-13: кандидаты КП реестра для заявки — совпадение по координатам
 * (haversine ≤ radiusM) и/или по адресу (пересечение значимых токенов).
 * Опционально: ?limit=1..20 (деф 5), ?radius=м (деф 250).
 * Ответ: { candidates: AreaMatchCandidate[] } (контракт studio-types).
 */

type Params = { params: Promise<{ id: string; orderId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id, orderId } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }
  const order = await db.order.findFirst({ where: { id: orderId, botId: id } });
  if (!order) {
    return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 });
  }

  const sp = req.nextUrl.searchParams;
  const limitParam = Number(sp.get('limit') ?? '');
  const radiusParam = Number(sp.get('radius') ?? '');

  const candidates = await matchAreasFor(
    id,
    { lat: order.lat, lng: order.lng, address: order.address },
    {
      ...(Number.isFinite(limitParam) && limitParam > 0 ? { limit: Math.floor(limitParam) } : {}),
      ...(Number.isFinite(radiusParam) && radiusParam > 0 ? { radiusM: radiusParam } : {}),
    }
  );

  const res = NextResponse.json({ candidates });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
