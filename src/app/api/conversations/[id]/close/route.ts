import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

/** Закрыть обращение (снять флаг «нужен оператор») */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const conversation = await db.conversation.findUnique({ where: { id }, include: { bot: true } });
  if (!conversation || conversation.bot.userId !== user.id) {
    return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 });
  }

  await db.conversation.update({
    where: { id: conversation.id },
    data: { status: 'closed', needsOperator: false },
  });
  return NextResponse.json({ ok: true });
}
