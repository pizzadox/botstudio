import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';
import { getFlowCached } from '@/lib/flow-cache';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { inc } from '@/lib/metrics';
import crypto from 'crypto';

/** Cap для ?take — защита от «выкачаем всю таблицу» */
const MAX_TAKE = 500;

/** Последние N сообщений диалога (orderBy desc + reverse → хронология в ответе) */
function parseTake(req: NextRequest, fallback: number): number {
  const takeParam = Number(req.nextUrl.searchParams.get('take') ?? '');
  return Number.isFinite(takeParam) && takeParam > 0
    ? Math.min(Math.floor(takeParam), MAX_TAKE)
    : fallback;
}

/** Кнопки последнего блока меню — для кликабельных чипов в виджете */
function lastMenuButtons(botId: string, botUpdatedAt: Date, botFlow: string, messages: { id: string; role: string; nodeId: string | null }[]) {
  const lastBotWithNode = [...messages].reverse().find((m) => m.role === 'bot' && m.nodeId && m.nodeId !== '__operator');
  if (!lastBotWithNode) return { lastBotWithNodeId: undefined as string | undefined, buttons: undefined as { id: string; text: string }[] | undefined };
  try {
    const flow = getFlowCached(botId, botUpdatedAt, botFlow);
    const node = flow.nodes.find((n) => n.id === lastBotWithNode.nodeId);
    if (node?.type === 'buttons' && node.data.buttons?.length) {
      return { lastBotWithNodeId: lastBotWithNode.id, buttons: node.data.buttons };
    }
  } catch {
    return { lastBotWithNodeId: lastBotWithNode.id, buttons: undefined };
  }
  return { lastBotWithNodeId: lastBotWithNode.id, buttons: undefined };
}

type Params = { params: Promise<{ secret: string }> };

/** GET-ответы демо-эндпоинта никогда не кэшируются (IMP-BE21-11) */
function noStoreJson(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/**
 * Публичный API демо-чата (веб-виджет для сайта).
 * POST { text, conversationId? } → { conversationId, messages }
 * GET  ?conversationId=X        → { messages }  (polling новых сообщений, включая ответы оператора)
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { secret } = await params;
  const channel = await db.channel.findUnique({ where: { secret }, include: { bot: true } });
  if (!channel || channel.type !== 'web') {
    return NextResponse.json({ error: 'Канал не найден' }, { status: 404 });
  }

  // IMP-BE21-10: защита демо-эндпоинта — 20 сообщений с одного ip в минуту
  if (!rateLimit(`demo:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Слишком много сообщений' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const text = String(body.text ?? '').trim().slice(0, 2000);
    if (!text) return NextResponse.json({ error: 'Пустое сообщение' }, { status: 400 });

    const conversationId = body.conversationId ? String(body.conversationId) : undefined;

    // IMP-BE21-10: не больше 10 сообщений в один диалог в минуту (антиспам в виджете)
    if (conversationId && !rateLimit(`democonv:${conversationId}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Слишком часто, подождите минуту' }, { status: 429 });
    }

    // Стабильный id посетителя (localStorage виджета): один гость = одно обращение,
    // даже если localStorage с conversationId был потерян
    const visitorId = body.visitorId ? String(body.visitorId).slice(0, 64) : undefined;
    const externalUserId = visitorId ? `web:${visitorId}` : undefined;

    const result = await processInbound(channel.id, {
      conversationId,
      externalId: conversationId ?? externalUserId ?? crypto.randomBytes(12).toString('hex'),
      externalUserId,
      text,
      contact: 'Гость сайта',
    });

    if (!result.ok) {
      const map: Record<string, string> = {
        bot_not_published: 'Бот ещё не опубликован. Включите «Опубликован» в конструкторе.',
        channel_inactive: 'Канал отключён.',
      };
      return NextResponse.json({ error: map[result.error] ?? 'Ошибка обработки' }, { status: 409 });
    }

    const messages = (
      await db.message.findMany({
        where: { conversationId: result.conversationId },
        orderBy: { createdAt: 'desc' },
        take: parseTake(req, 100),
      })
    ).reverse();

    const { lastBotWithNodeId, buttons } = lastMenuButtons(
      channel.botId,
      channel.bot.updatedAt,
      channel.bot.flow,
      messages
    );

    return NextResponse.json({
      conversationId: result.conversationId,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        buttons: m.id === lastBotWithNodeId ? buttons : undefined,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    console.error('[demo webhook]', err);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  const { secret } = await params;

  // IMP-BE22-17: polling GET тоже дорогой — не больше 60 опросов с одного ip в минуту
  if (!rateLimit(`demog:${clientIp(req)}`, 60, 60_000)) {
    inc('rateLimited');
    return noStoreJson({ error: 'Слишком много запросов' }, 429);
  }

  const channel = await db.channel.findUnique({ where: { secret }, include: { bot: true } });
  if (!channel || channel.type !== 'web') {
    return noStoreJson({ error: 'Канал не найден' }, 404);
  }

  const conversationId = req.nextUrl.searchParams.get('conversationId');
  if (!conversationId) return noStoreJson({ messages: [] });

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, botId: channel.botId, source: 'web' },
  });
  if (!conversation) return noStoreJson({ messages: [] });

  const messages = (
    await db.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: parseTake(req, 100),
    })
  ).reverse();

  const { lastBotWithNodeId, buttons } = lastMenuButtons(
    channel.botId,
    channel.bot.updatedAt,
    channel.bot.flow,
    messages
  );

  // IMP-BE21-11: публичный polling-ответ — no-store, чтобы прокси не кэшировали
  return noStoreJson({
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      buttons: m.id === lastBotWithNodeId ? buttons : undefined,
      createdAt: m.createdAt,
    })),
  });
}
