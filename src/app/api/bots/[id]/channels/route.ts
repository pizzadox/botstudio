import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { maskToken, webhookUrlFor } from '@/lib/mask';
import type { Channel } from '@prisma/client';

type Params = { params: Promise<{ id: string }> };

const VALID_TYPES = ['telegram', 'whatsapp', 'max', 'web'];

/**
 * Санитайзер канала: token не покидает сервер (IMP-BE21-01) —
 * фронт получает tokenMasked/hasToken и готовый webhookUrl.
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
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  const origin = new URL(req.url).origin;
  const channels = await db.channel.findMany({ where: { botId: id }, orderBy: { createdAt: 'asc' } });
  return NextResponse.json({ channels: channels.map((ch) => sanitizeChannel(ch, origin)) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  try {
    const body = await req.json();
    const type = String(body.type ?? '');
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Неизвестный тип канала' }, { status: 400 });
    }
    const title = String(body.title ?? '').trim().slice(0, 120) || null;
    const token = String(body.token ?? '').trim() || null;
    const phone = String(body.phone ?? '').trim() || null;

    if ((type === 'telegram' || type === 'max') && !token) {
      return NextResponse.json({ error: 'Укажите токен бота' }, { status: 400 });
    }

    const defaults: Record<string, string> = {
      telegram: 'Telegram-бот',
      whatsapp: 'WhatsApp',
      max: 'MAX-бот',
      web: 'Демо-чат сайта',
    };

    const channel = await db.channel.create({
      data: {
        botId: bot.id,
        type,
        title: title ?? defaults[type],
        token,
        phone,
      },
    });
    const origin = new URL(req.url).origin;
    return NextResponse.json({ channel: sanitizeChannel(channel, origin) });
  } catch (err) {
    console.error('[channels POST]', err);
    return NextResponse.json({ error: 'Не удалось создать канал' }, { status: 500 });
  }
}
