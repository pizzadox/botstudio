import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

/** GET: список записей базы знаний бота */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  const knowledge = await db.knowledgeItem.findMany({
    where: { botId: id },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ knowledge });
}

/** POST: добавить запись в базу знаний */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  try {
    const body = (await req.json()) as { title?: string; content?: string };
    const title = (body.title ?? '').trim().slice(0, 200);
    const content = (body.content ?? '').trim().slice(0, 10000);
    if (!title || !content) {
      return NextResponse.json({ error: 'Укажите заголовок и содержимое' }, { status: 400 });
    }
    const item = await db.knowledgeItem.create({
      data: { botId: id, title, content },
    });
    return NextResponse.json({ ok: true, item });
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
}
