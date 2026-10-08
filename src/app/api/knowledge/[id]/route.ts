import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { invalidateAssistantConfig } from '@/lib/ai-assistant';

type Params = { params: Promise<{ id: string }> };

/** Проверка владения: запись базы знаний → её бот → владелец */
async function findOwnedItem(req: NextRequest, id: string) {
  const user = await getSessionUser(req);
  if (!user) return { status: 401 as const };
  const item = await db.knowledgeItem.findUnique({
    where: { id },
    include: { bot: { select: { userId: true } } },
  });
  if (!item || item.bot.userId !== user.id) return { status: 404 as const };
  return { item };
}

/** PUT: изменить запись базы знаний */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const found = await findOwnedItem(req, id);
  if ('status' in found) {
    return NextResponse.json(
      { error: found.status === 401 ? 'Требуется авторизация' : 'Запись не найдена' },
      { status: found.status }
    );
  }

  try {
    const body = (await req.json()) as { title?: string; content?: string };
    const title = (body.title ?? '').trim().slice(0, 200);
    const content = (body.content ?? '').trim().slice(0, 10000);
    if (!title || !content) {
      return NextResponse.json({ error: 'Укажите заголовок и содержимое' }, { status: 400 });
    }
    const item = await db.knowledgeItem.update({
      where: { id },
      data: { title, content },
    });
    invalidateAssistantConfig(found.item.botId); // сброс кэша ассистента
    return NextResponse.json({ ok: true, item });
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
}

/** DELETE: удалить запись базы знаний */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const found = await findOwnedItem(req, id);
  if ('status' in found) {
    return NextResponse.json(
      { error: found.status === 401 ? 'Требуется авторизация' : 'Запись не найдена' },
      { status: found.status }
    );
  }
  await db.knowledgeItem.delete({ where: { id } });
  invalidateAssistantConfig(found.item.botId); // сброс кэша ассистента
  return NextResponse.json({ ok: true });
}
