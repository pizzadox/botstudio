import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { deliverTextToConversation } from '@/lib/deliver';
import type { EngineState } from '@/lib/flow-types';

type Params = { params: Promise<{ id: string }> };

/** Закрыть обращение: снять флаг «нужен оператор» и вернуть управление боту */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });

  const conversation = await db.conversation.findUnique({ where: { id }, include: { bot: true } });
  if (!conversation || conversation.bot.userId !== user.id) {
    return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 });
  }

  // Очищаем режим оператора — бот снова ведёт диалог с начала сценария
  let state: EngineState | null = null;
  try {
    state = conversation.state ? (JSON.parse(conversation.state) as EngineState) : null;
  } catch {
    state = null;
  }
  let nextState: string | null = conversation.state;
  if (state) {
    delete state.vars['__operator'];
    // Сбрасываем и режим беседы (заявки/чат), чтобы бот снова вёл сценарий
    delete state.vars['__mode'];
    delete state.vars['__orderId'];
    delete state.vars['__orderNumber'];
    state.currentNodeId = null;
    state.waiting = 'none';
    nextState = JSON.stringify(state);
  }

  await db.conversation.update({
    where: { id: conversation.id },
    data: { status: 'closed', needsOperator: false, state: nextState },
  });

  // Сообщаем клиенту в мессенджере, что обращение закрыто
  await deliverTextToConversation(
    conversation.id,
    '✅ Обращение закрыто. Если понадобится помощь — просто напишите нам!'
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}
