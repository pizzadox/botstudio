/**
 * Одноразовая миграция: склеивает дубли-обращения в инбоксе.
 *
 * Проблема: текстовые сообщения MAX приходят с chat_id, а нажатия кнопок —
 * с user_id, из-за чего один человек получал несколько обращений.
 * Теперь обращение одно (Conversation.externalUserId), а старые дубли
 * склеивает этот скрипт: сообщения переносятся в главный диалог, дубли
 * удаляются.
 *
 * Правила (только для source='max'):
 *  - группа = один bot + одинаковый непустой contact;
 *  - primary = диалог с наибольшим числом «обычных» сообщений (не callback);
 *  - needsOperator = OR по группе; state берём от самого свежего диалога
 *    (чтобы сохранить режим оператора); externalUserId восстанавливаем из
 *    externalId дубля, если это число (user_id).
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const conversations = await db.conversation.findMany({
    where: { source: 'max', contact: { not: null } },
    include: { messages: { select: { id: true, externalKey: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const groups = new Map<string, typeof conversations>();
  for (const c of conversations) {
    const key = `${c.botId}::${c.contact}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  let mergedCount = 0;

  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    // primary: максимум «обычных» сообщений (externalKey не начинается с cb:)
    const score = (c: (typeof group)[number]) =>
      c.messages.filter((m) => !m.externalKey?.startsWith('cb:')).length;
    const sorted = [...group].sort((a, b) => score(b) - score(a) || a.createdAt.getTime() - b.createdAt.getTime());
    const primary = sorted[0];
    const dupes = sorted.slice(1);

    console.log(`Группа ${key}: ${group.length} диалогов, primary=${primary.id} (${primary.externalId})`);

    for (const dupe of dupes) {
      // 1. Переносим сообщения
      for (const m of dupe.messages) {
        try {
          await db.message.update({ where: { id: m.id }, data: { conversationId: primary.id } });
        } catch {
          console.warn(`  сообщение ${m.id} пропущено (конфликт ключа)`);
        }
      }

      // 2. Сливаем флаги и состояние
      const primaryNewer = primary.updatedAt.getTime() >= dupe.updatedAt.getTime();
      await db.conversation.update({
        where: { id: primary.id },
        data: {
          needsOperator: primary.needsOperator || dupe.needsOperator,
          state: primaryNewer ? primary.state : dupe.state,
          channelId: primary.channelId ?? dupe.channelId,
          // externalId дубля — это user_id (обращение создано из callback'а)
          externalUserId:
            primary.externalUserId ??
            (/^\d+$/.test(dupe.externalId ?? '') && dupe.externalId !== primary.externalId
              ? dupe.externalId
              : null),
        },
      });

      // 3. Удаляем дубль
      await db.conversation.delete({ where: { id: dupe.id } });
      mergedCount += 1;
      console.log(`  склеен ${dupe.id} (externalId=${dupe.externalId}) → ${primary.id}`);
    }
  }

  console.log(mergedCount ? `Готово: склеено диалогов — ${mergedCount}` : 'Дублей не найдено');
}

main().finally(() => db.$disconnect());
