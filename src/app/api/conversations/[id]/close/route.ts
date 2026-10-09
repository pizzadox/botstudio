import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { deliverTextToConversation } from '@/lib/deliver';
import { findMainMenu, interpolate } from '@/lib/flow-engine';
import type { EngineState, Flow } from '@/lib/flow-types';

/** Постоянная кнопка «Мои заявки» — как в боте (webhook.ts) */
const BTN_MY_ORDERS = '📦 Мои заявки';
/** Лимит рядов inline-клавиатуры MAX */
const MAX_KEYBOARD_ROWS = 8;

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
  let flow: Flow = { nodes: [], edges: [] };
  try {
    flow = JSON.parse(conversation.bot.flow) as Flow;
  } catch {
    flow = { nodes: [], edges: [] };
  }

  // Главное меню — возвращаем управление ему: клик по кнопке продолжит сценарий
  const menu = findMainMenu(flow);
  let nextState: string | null = conversation.state;
  const menuButtons = (menu?.data.buttons ?? []).map((b) => ({ ...b }));
  if (state || menu) {
    const st: EngineState = state ?? {
      currentNodeId: null,
      waiting: 'none',
      vars: {},
      history: [],
    };
    delete st.vars['__operator'];
    // Сбрасываем и режим беседы (заявки/чат), чтобы бот снова вёл сценарий
    delete st.vars['__mode'];
    delete st.vars['__orderId'];
    delete st.vars['__orderNumber'];
    if (menu) {
      st.currentNodeId = menu.id;
      st.waiting = 'buttons';
      st.vars['__last_menu'] = menu.id;
    } else {
      st.currentNodeId = null;
      st.waiting = 'none';
    }
    nextState = JSON.stringify(st);
  }

  await db.conversation.update({
    where: { id: conversation.id },
    // IMP-26-01 (REV-5б): фиксируем момент закрытия — зеркало-проверка в
    // persistBotMessages (webhook.ts) по нему отбрасывает реплики бота,
    // сгенерированные ПОСЛЕ закрытия (не пишутся в БД, не доставляются).
    data: { status: 'closed', needsOperator: false, state: nextState, closedAt: new Date() },
  });

  // Сообщаем клиенту в мессенджере, что обращение закрыто, и возвращаем меню
  const closedText = '✅ Обращение закрыто. Если понадобится помощь — просто напишите нам!';
  const menuText = menu
    ? interpolate(menu.data.text, state?.vars ?? {}) || 'Выберите, что вас интересует:'
    : null;

  // «📦 Мои заявки» — постоянная кнопка навигации, если хватает рядов клавиатуры
  const buttons = [...menuButtons];
  if (
    menu &&
    buttons.length < MAX_KEYBOARD_ROWS - 1 &&
    !buttons.some((b) => b.text.trim() === BTN_MY_ORDERS)
  ) {
    buttons.push({ id: '__nav_orders', text: BTN_MY_ORDERS });
  }

  // Сообщаем клиенту в мессенджере, что обращение закрыто, и возвращаем меню.
  // IMP-BE21-24: внутри пары «сообщение в БД + доставка наружу» запросы
  // независимы — идёт параллельно; пары между собой последовательно,
  // чтобы «Обращение закрыто» всегда было в чате раньше меню.
  const closePair = Promise.all([
    db.message.create({
      data: { conversationId: conversation.id, role: 'bot', text: closedText, nodeId: '__bot' },
    }),
    deliverTextToConversation(conversation.id, closedText).catch(() => {}),
  ]);
  if (menu && menuText) {
    await closePair;
    await Promise.all([
      db.message.create({
        data: {
          conversationId: conversation.id,
          role: 'bot',
          text: menuText,
          // IMP-25-REV-4: реальный nodeId меню-узла — веб-виджет рисует чипы
          // (спец-маркер '__bot' оставлен только для сообщений без узла)
          nodeId: menu.id,
        },
      }),
      deliverTextToConversation(conversation.id, menuText, buttons).catch(() => {}),
    ]);
  } else {
    await closePair;
  }

  return NextResponse.json({ ok: true });
}
