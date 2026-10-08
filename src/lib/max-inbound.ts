import { db } from '@/lib/db';
import { processInbound } from '@/lib/webhook';
import { claimInboundKey } from '@/lib/inbound-dedupe';
import {
  maxAnswerCallback,
  maxSendMessage,
  type MaxUpdate,
} from '@/lib/max-api';

/**
 * Единая обработка апдейтов MAX — используется и long-polling воркером
 * (src/lib/max-poller.ts), и вебхук-роутом (/api/webhook/max/[secret]).
 *
 * Ключевые правила:
 *  - текстовые сообщения MAX присылает с chat_id диалога, а нажатия кнопок —
 *    только с user_id; обращение идентифицируется по человеку (user_id),
 *    поэтому кнопки и текст попадают в ОДИН диалог (раньше плодились);
 *  - на callback всегда отвечаем через /answers: с текстом бота или
 *    молча (silent) — никаких заглушек «…»;
 *  - если диалог ждёт оператора, клики по кнопкам подтверждаем короткой
 *    запиской (не чаще раза в 10 минут), сообщения пользователя попадают в инбокс.
 */

const THROTTLE_MS = 650; // лимит MAX: 2 сообщения/сек на диалог
const OPERATOR_NOTE =
  '📨 Ваше сообщение передано оператору. Ответим при первой возможности!';
const OPERATOR_NOTE_INTERVAL_MS = 10 * 60 * 1000;

/** chat_id в MAX — число; плейсхолдеры (user:...) отправке не подлежат */
function isSendableChatId(id: string | undefined | null): id is string {
  return !!id && /^\d+$/.test(id);
}

async function markStatus(channelId: string, status: string): Promise<void> {
  await db.channel.update({ where: { id: channelId }, data: { lastStatus: status } }).catch(() => {});
}

/** Подтверждение callback'а без сообщения (останавливает «крутилку»). */
async function ackCallback(token: string, callbackId?: string): Promise<void> {
  if (callbackId) await maxAnswerCallback(token, callbackId).catch(() => {});
}

export async function handleMaxUpdate(
  channelId: string,
  token: string,
  upd: MaxUpdate,
  opts?: { botUserId?: number }
): Promise<void> {
  if (upd?.update_type === 'message_created') {
    await handleMessageCreated(channelId, token, upd, opts?.botUserId);
    return;
  }
  if (upd?.update_type === 'message_callback') {
    await handleMessageCallback(channelId, token, upd);
  }
}

/** Обычное текстовое сообщение от пользователя. */
async function handleMessageCreated(
  channelId: string,
  token: string,
  upd: MaxUpdate,
  botUserId?: number
): Promise<void> {
  const msg = upd.payload?.message ?? upd.message;
  if (!msg) return;

  const sender = msg.sender ?? {};
  if (sender.is_bot === true || (botUserId !== undefined && sender.user_id === botUserId)) return;

  const text = String(msg.body?.text ?? '').trim();
  if (!text) return; // сообщения только с вложениями не обрабатываем

  const chatId = String(msg.recipient?.chat_id ?? sender.user_id ?? '');
  if (!chatId) return;

  // Защита от дублей: MAX может доставить сообщение и через long polling,
  // и через вебхук, плюс ретраи после таймаутов. BE22-16: in-memory claim
  // перенесён ПОСЛЕ успешной обработки — при сбое ключ не расходуется и
  // повторная доставка сможет обработать сообщение. Конкурентные дубли ловит
  // unique(conversationId, externalKey) в БД (processInbound отвечает
  // duplicate:true без повторного ответа) — проверено по schema.prisma.
  const mid = msg.body?.mid;

  const contact = sender.name ?? sender.first_name ?? sender.username ?? undefined;
  const externalUserId = sender.user_id != null ? String(sender.user_id) : undefined;

  const result = await processInbound(channelId, {
    externalId: chatId,
    externalUserId,
    text: text.slice(0, 2000),
    contact,
    externalKey: mid,
  });

  if (!result.ok) {
    if (result.error === 'bot_not_published') {
      await markStatus(channelId, 'Опубликуйте бота в конструкторе');
    }
    console.warn('[max] сообщение пропущено:', result.error);
    return;
  }
  // BE22-16: помечаем обработанным только после успешного ответа движка
  // (в т.ч. duplicate — сообщение уже обработано ранее)
  if (mid) claimInboundKey(`${channelId}:${mid}`);
  if (result.duplicate) return; // уже отвечали на это сообщение

  await sendReplies(channelId, token, chatId, result.messages);
}

/** Нажатие inline-кнопки: payload трактуем как выбор пользователя. */
async function handleMessageCallback(
  channelId: string,
  token: string,
  upd: MaxUpdate
): Promise<void> {
  const cb = upd.payload?.callback ?? upd.callback;
  if (!cb) return;

  const callbackId = cb.callback_id ?? '';
  const choice = String(cb.button?.text ?? cb.payload ?? '').trim();
  if (!choice) {
    await ackCallback(token, callbackId);
    return;
  }

  const externalUserId = cb.user?.user_id != null ? String(cb.user.user_id) : undefined;
  // В callback MAX иногда передаёт контекст сообщения — chat_id
  const chatHint = cb.message?.recipient?.chat_id != null ? String(cb.message.recipient.chat_id) : undefined;

  const contact = cb.user?.name ?? cb.user?.first_name ?? cb.user?.username ?? undefined;

  const result = await processInbound(channelId, {
    externalId: chatHint,
    externalUserId,
    text: choice.slice(0, 2000),
    contact,
    externalKey: callbackId ? `cb:${callbackId}` : undefined,
  });

  if (!result.ok) {
    console.warn('[max] callback пропущен:', result.error);
    await ackCallback(token, callbackId);
    return;
  }
  // BE22-16: claim после успешной обработки — конкурентные дубли ловит
  // unique(conversationId, externalKey) в БД (externalKey = cb:<callback_id>)
  if (callbackId) claimInboundKey(`${channelId}:cb:${callbackId}`);
  if (result.duplicate) {
    await ackCallback(token, callbackId);
    return;
  }

  // Диалог ждёт оператора — движок молчит. Подтверждаем клик короткой
  // запиской (не спамим: не чаще раза в 10 минут на диалог).
  if (result.messages.length === 0) {
    if (result.needsOperator) {
      await answerOperatorNote(channelId, token, callbackId, result.conversationId, result.chatId);
    } else {
      await ackCallback(token, callbackId);
    }
    return;
  }

  // Первый ответ — прямо в /answers (мгновенно, без «крутилки»),
  // остальные — обычными сообщениями
  const [first, ...rest] = result.messages;
  if (callbackId) {
    await maxAnswerCallback(token, callbackId, { text: first.text, buttons: first.buttons });
  } else if (isSendableChatId(result.chatId)) {
    await sendOne(channelId, token, result.chatId, first);
  }
  let sent = callbackId ? 1 : 0;
  for (const m of rest) {
    if (!isSendableChatId(result.chatId)) {
      console.warn('[max] некуда отправить остаток ответа: chat_id неизвестен');
      break;
    }
    if (sent > 0) await sleep(THROTTLE_MS);
    await sendOne(channelId, token, result.chatId, m);
    sent += 1;
  }
}

/** Записка «передал оператору»: через /answers для клика, текстом для обычных сообщений. */
async function answerOperatorNote(
  channelId: string,
  token: string,
  callbackId: string | undefined,
  conversationId: string,
  chatId?: string
): Promise<void> {
  if (!shouldSendOperatorNote(conversationId)) return;
  // Фиксируем записку в инбоксе — оператор видит, что клиент уведомлён
  await db.message
    .create({
      data: { conversationId, role: 'bot', text: OPERATOR_NOTE, nodeId: '__operator' },
    })
    .catch(() => {});
  if (callbackId) {
    const res = await maxAnswerCallback(token, callbackId, { text: OPERATOR_NOTE });
    if (!res.ok) console.warn('[max] note via answers:', res.error);
    return;
  }
  if (isSendableChatId(chatId)) {
    await sendOne(channelId, token, chatId, { text: OPERATOR_NOTE });
  }
}

// Одноразовая записка на «тихий период» — без спама при каждом сообщении
const noteGlobals = globalThis as unknown as { __maxOperatorNotes?: Map<string, number> };
const OPERATOR_NOTES_CAP = 500;
function shouldSendOperatorNote(conversationId: string): boolean {
  if (!noteGlobals.__maxOperatorNotes) noteGlobals.__maxOperatorNotes = new Map();
  const map = noteGlobals.__maxOperatorNotes;
  // Защита от неограниченного роста: срезаем самые старые ключи
  while (map.size >= OPERATOR_NOTES_CAP) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  const now = Date.now();
  const last = map.get(conversationId) ?? 0;
  if (now - last < OPERATOR_NOTE_INTERVAL_MS) return false;
  map.set(conversationId, now);
  return true;
}

export async function sendReplies(
  channelId: string,
  token: string,
  chatId: string,
  messages: { text: string; buttons?: { id: string; text: string }[] }[]
): Promise<void> {
  // BE22-03: неудача отправки одного ответа не отменяет остальные —
  // логируем, считаем failures и продолжаем (частичная доставка лучше полной тишины).
  let first = true;
  let failures = 0;
  for (const m of messages) {
    if (!first) await sleep(THROTTLE_MS);
    first = false;
    const ok = await sendOne(channelId, token, chatId, m);
    if (!ok) failures += 1;
  }
  if (failures > 0) {
    console.warn(`[max] sendReplies: не доставлено ${failures} из ${messages.length} (чат ${chatId})`);
  }
}

async function sendOne(
  channelId: string,
  token: string,
  chatId: string,
  m: { text: string; buttons?: { id: string; text: string }[] }
): Promise<boolean> {
  const res = await maxSendMessage(token, chatId, m.text, m.buttons);
  if (!res.ok) {
    console.error('[max] не удалось отправить ответ в чат', chatId, '—', res.error);
    await markStatus(channelId, `Ошибка отправки: ${res.error}`);
    return false;
  }
  // BE22-13: PII — текст сообщения клиента в лог не попадает (только длина)
  console.log(`[max] ответ → чат ${chatId}: ${m.text.length} симв.`);
  return true;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
