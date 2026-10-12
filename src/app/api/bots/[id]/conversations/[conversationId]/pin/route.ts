import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string; conversationId: string }> };

/**
 * Закрепить/открепить диалог в инбоксе (22-BE2, IMP-BE22-12b).
 * POST { pinned: boolean } → { ok, pinnedAt }
 * Закреплённые диалоги поднимаются вверх списка (orderBy pinnedAt desc).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, conversationId } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: 'Бот не найден' }, { status: 404 });
  }

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, botId: true },
  });
  if (!conversation || conversation.botId !== id) {
    return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 });
  }

  try {
    const body = await req.json().catch(() => null);
    const pinned = body?.pinned === true;

    const updated = await db.conversation.update({
      where: { id: conversationId },
      data: { pinnedAt: pinned ? new Date() : null },
      select: { id: true, pinnedAt: true },
    });

    return NextResponse.json({ ok: true, pinned: updated.pinnedAt != null, pinnedAt: updated.pinnedAt });
  } catch (err) {
    console.error('[conversations pin]', err);
    return NextResponse.json({ error: 'Не удалось изменить закрепление' }, { status: 500 });
  }
}
