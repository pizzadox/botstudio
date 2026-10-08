import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { maskToken, webhookUrlFor } from '@/lib/mask';
import { normalizeFlow } from '@/lib/flow-validate';
import type { Bot, Channel } from '@prisma/client';

type Params = { params: Promise<{ id: string }> };

async function ownedBot(req: NextRequest, id: string) {
  const user = await getSessionUser(req);
  if (!user) return { error: 'auth' as const };
  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) return { error: 'notfound' as const };
  return { bot };
}

/** Настройки MyTKO без секрета: только флаги для бейджа (как в bots/route.ts) */
function mytkoSummary(configJson: string): { enabled: boolean; hasToken: boolean } | null {
  try {
    const cfg = JSON.parse(configJson ?? '{}') as { enabled?: boolean; token?: string };
    if (cfg.enabled || cfg.token) {
      return { enabled: cfg.enabled === true, hasToken: !!cfg.token };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Санитайзер бота: mytkoConfig (содержит token/пароли) не покидает сервер,
 * вместо него — mytko:{enabled,hasToken} (IMP-BE21-01).
 */
function sanitizeBot(bot: Bot) {
  return {
    id: bot.id,
    name: bot.name,
    description: bot.description,
    status: bot.status,
    flow: bot.flow,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
    mytko: mytkoSummary(bot.mytkoConfig),
  };
}

/**
 * Санитайзер канала: token не отдаём (только маска + hasToken),
 * webhookUrl собираем на сервере. secret остаётся — фронт показывает
 * URL/демо-чат по нему (IMP-BE21-01).
 */
function sanitizeChannel(ch: Channel, origin: string) {
  return {
    id: ch.id,
    botId: ch.botId,
    type: ch.type,
    title: ch.title,
    tokenMasked: maskToken(ch.token),
    hasToken: !!ch.token,
    phone: ch.phone,
    secret: ch.secret,
    webhookUrl: webhookUrlFor(origin, ch.type, ch.secret),
    active: ch.active,
    lastStatus: ch.lastStatus,
    createdAt: ch.createdAt,
  };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { bot, error } = await ownedBot(req, id);
  if (error === 'auth') return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  if (!bot) return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });

  const origin = new URL(req.url).origin;
  const [channels, conversationsCount] = await Promise.all([
    db.channel.findMany({
      where: { botId: bot.id },
      orderBy: { createdAt: 'asc' },
    }),
    db.conversation.count({ where: { botId: bot.id } }),
  ]);

  return NextResponse.json({
    bot: sanitizeBot(bot),
    channels: channels.map((ch) => sanitizeChannel(ch, origin)),
    conversationsCount,
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { bot, error } = await ownedBot(req, id);
  if (error === 'auth') return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  if (!bot) return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });

  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    // IMP-BE21-12: ограничиваем длину строк (name ≤120, description ≤500)
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120);
    if (typeof body.description === 'string')
      data.description = body.description.trim().slice(0, 500) || null;
    if (typeof body.status === 'string' && ['draft', 'published'].includes(body.status)) {
      data.status = body.status;
    }
    // IMP-BE22-21: валидация/нормализация сценария перед сохранением.
    // normalizeFlow принимает объект {nodes,edges} (или JSON-строку) и возвращает
    // либо нормализованную строку JSON, либо ошибку для 400.
    if (body.flow !== undefined) {
      const v = normalizeFlow(body.flow);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      data.flow = v.flow;
    }

    const updated = await db.bot.update({ where: { id: bot.id }, data });
    return NextResponse.json({ bot: sanitizeBot(updated) });
  } catch (err) {
    console.error('[bots PUT]', err);
    return NextResponse.json({ error: 'Не удалось сохранить' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { bot, error } = await ownedBot(req, id);
  if (error === 'auth') return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  if (!bot) return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });

  await db.bot.delete({ where: { id: bot.id } });
  return NextResponse.json({ ok: true });
}
