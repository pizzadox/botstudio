import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { mytkoSyncOrder, parseMytkoConfig } from '@/lib/mytko';

type Params = { params: Promise<{ id: string; orderId: string }> };

/**
 * Синхронизация заявки с MyTKO «Чистая логистика»:
 * проверяем токен (логин/пароль), получаем отчёты водителей и ищем факт вывоза
 * по адресу заявки. Результат пишется в заявку (mytkoStatus / mytkoInfo / mytkoError)
 * и показывается бейджем во всех разделах.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, orderId } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || order.botId !== bot.id) {
    return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 });
  }

  const cfg = parseMytkoConfig(bot.mytkoConfig);
  if (!cfg.enabled) {
    return NextResponse.json({ error: 'Интеграция MyTKO выключена в разделе «Каналы»' }, { status: 400 });
  }

  // Коды КП: реестр («все возможные») + ручной список
  const areas = await db.mytkoArea.findMany({ where: { botId: bot.id }, select: { lkCode: true } });
  const areaCodes = [
    ...new Set([
      ...areas.map((a) => a.lkCode),
      ...(cfg.lkCodes ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    ]),
  ];

  const res = await mytkoSyncOrder(
    cfg,
    {
      city: order.city,
      address: order.address,
      createdAt: order.createdAt,
    },
    areaCodes
  );

  const updated = await db.order.update({
    where: { id: order.id },
    data: {
      mytkoStatus: res.status,
      mytkoSyncAt: new Date(),
      mytkoInfo: res.info,
      mytkoError: res.error,
    },
  });

  return NextResponse.json({ ok: res.ok, order: updated });
}
