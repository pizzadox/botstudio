/**
 * Probe: сколько рядов inline_keyboard принимает MAX (реальный токен, chat_id=1 —
 * ожидаемая ошибка «chat not found» означает, что формат клавиатуры валиден).
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function probe(token, rows) {
  const body = {
    text: `probe ${rows} rows`,
    attachments: [
      {
        type: 'inline_keyboard',
        payload: {
          buttons: Array.from({ length: rows }, (_, i) => [
            { type: 'callback', text: `Кнопка ${i + 1}`, payload: `btn${i + 1}` },
          ]),
        },
      },
    ],
  };
  const res = await fetch('https://botapi.max.ru/messages?chat_id=1', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { rows, status: res.status, code: json?.code, message: json?.message };
}

(async () => {
  const ch = await prisma.channel.findFirst({ where: { type: 'max' } });
  if (!ch) { console.log('no max channel'); return; }
  for (const rows of [8, 9, 10]) {
    const r = await probe(ch.token, rows);
    console.log(JSON.stringify(r));
  }
  await prisma.$disconnect();
})();
