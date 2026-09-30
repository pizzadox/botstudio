import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';
import crypto from 'crypto';
import type { Flow } from '@/lib/flow-types';

type Params = { params: Promise<{ secret: string }> };

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

  try {
    const body = await req.json();
    const text = String(body.text ?? '').trim().slice(0, 2000);
    if (!text) return NextResponse.json({ error: 'Пустое сообщение' }, { status: 400 });

    const conversationId = body.conversationId ? String(body.conversationId) : undefined;
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

    const messages = await db.message.findMany({
      where: { conversationId: result.conversationId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    // Кнопки последнего блока меню — для кликабельных чипов в виджете
    let lastButtons: { id: string; text: string }[] | undefined;
    const lastBotWithNode = [...messages].reverse().find((m) => m.role === 'bot' && m.nodeId && m.nodeId !== '__operator');
    if (lastBotWithNode) {
      try {
        const flow = JSON.parse(channel.bot.flow) as Flow;
        const node = flow.nodes.find((n) => n.id === lastBotWithNode.nodeId);
        if (node?.type === 'buttons' && node.data.buttons?.length) {
          lastButtons = node.data.buttons;
        }
      } catch {
        lastButtons = undefined;
      }
    }

    return NextResponse.json({
      conversationId: result.conversationId,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        buttons: m.id === lastBotWithNode?.id ? lastButtons : undefined,
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
  const channel = await db.channel.findUnique({ where: { secret }, include: { bot: true } });
  if (!channel || channel.type !== 'web') {
    return NextResponse.json({ error: 'Канал не найден' }, { status: 404 });
  }

  const conversationId = req.nextUrl.searchParams.get('conversationId');
  if (!conversationId) return NextResponse.json({ messages: [] });

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, botId: channel.botId, source: 'web' },
  });
  if (!conversation) return NextResponse.json({ messages: [] });

  const messages = await db.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  // Кнопки последнего блока меню — и в polling-ответах
  let lastButtons: { id: string; text: string }[] | undefined;
  const lastBotWithNode = [...messages].reverse().find((m) => m.role === 'bot' && m.nodeId && m.nodeId !== '__operator');
  if (lastBotWithNode) {
    try {
      const flow = JSON.parse(channel.bot.flow) as Flow;
      const node = flow.nodes.find((n) => n.id === lastBotWithNode.nodeId);
      if (node?.type === 'buttons' && node.data.buttons?.length) {
        lastButtons = node.data.buttons;
      }
    } catch {
      lastButtons = undefined;
    }
  }

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      buttons: m.id === lastBotWithNode?.id ? lastButtons : undefined,
      createdAt: m.createdAt,
    })),
  });
}
