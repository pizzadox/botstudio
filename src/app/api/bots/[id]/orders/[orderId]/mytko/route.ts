import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { mytkoSyncOrder, parseMytkoConfig, getFreshToken, getAreaCodesCached } from '@/lib/mytko';

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

  // Коды КП: реестр («все возможные», через кэш TTL 5 мин) + ручной список
  const registryCodes = await getAreaCodesCached(bot.id);
  const areaCodes = [
    ...new Set([
      ...registryCodes,
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

  // Авто-реавторизация могла обновить истёкший токен — сохраняем его в конфиг бота,
  // чтобы следующие запросы не начинались с протухшего токена
  if (cfg.enabled && cfg.apiUrl) {
    const fresh = getFreshToken(cfg.apiUrl, cfg.username);
    if (fresh && fresh !== cfg.token) {
      cfg.token = fresh;
      cfg.tokenIssuedAt = new Date().toISOString();
      await db.bot.update({ where: { id: bot.id }, data: { mytkoConfig: JSON.stringify(cfg) } });
    }
  }

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
