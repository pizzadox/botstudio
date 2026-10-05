/**
 * Демо-двойник бота «Экосити» под аккаунтом demo — для браузерной проверки UI заявок.
 * Удаляется скриптом download/cleanup-demo-twin.ts.
 * Запуск: bun download/seed-demo-twin.ts
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const user = await db.user.findUnique({ where: { username: 'demo' } });
  if (!user) throw new Error('demo-пользователь не найден');

  const eco = await db.bot.findFirst({ where: { user: { username: 'pizzadox' } } });
  if (!eco) throw new Error('Бот Экосити не найден');

  // Удаляем старого двойника, если был
  await db.bot.deleteMany({ where: { userId: user.id, name: 'Экосити-двойник (проверка UI)' } });

  const bot = await db.bot.create({
    data: {
      userId: user.id,
      name: 'Экосити-двойник (проверка UI)',
      description: 'Временный бот для проверки карты заявок',
      status: 'published',
      flow: eco.flow,
    },
  });
  console.log('BOT TWIN:', bot.id);

  const conv = await db.conversation.create({
    data: {
      botId: bot.id,
      source: 'max',
      externalId: '326491749',
      externalUserId: 'twin-ivanov',
      contact: 'Иванов Алексей',
      status: 'open',
    },
  });

  const o1 = await db.order.create({
    data: {
      botId: bot.id,
      conversationId: conv.id,
      externalUserId: 'twin-ivanov',
      number: 1,
      type: 'waste',
      clientName: 'Иванов Алексей',
      phone: '+7 916 220-14-05',
      address: 'Москва, ул. Тверская, 15',
      size: '8 м³ (бункер)',
      wishDate: 'завтра до 12:00',
      status: 'new',
      lat: 55.7615,
      lng: 37.6094,
    },
  });
  await db.message.create({
    data: {
      conversationId: conv.id,
      role: 'user',
      text: 'Здравствуйте! Машина точно придёт завтра до 12?',
      orderId: o1.id,
    },
  });

  await db.order.create({
    data: {
      botId: bot.id,
      externalUserId: 'twin-petrova',
      number: 2,
      type: 'kgm',
      clientName: 'Петрова Мария',
      phone: '+7 903 711-48-22',
      address: 'Москва, ул. Профсоюзная, 42',
      size: 'диван, 2 мешка',
      wishDate: 'среда',
      status: 'in_progress',
      assignee: 'Бригада №2',
      lat: 55.6725,
      lng: 37.5626,
    },
  });

  await db.order.create({
    data: {
      botId: bot.id,
      externalUserId: 'twin-sidorov',
      number: 3,
      type: 'waste',
      clientName: 'Сидоров Пётр',
      address: 'Москва, ул. Строителей, 8к2',
      size: '8 м³',
      status: 'completed',
      lat: 55.6979,
      lng: 37.566,
      completedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
    },
  });

  await db.order.create({
    data: {
      botId: bot.id,
      externalUserId: 'twin-morozov',
      number: 4,
      type: 'waste',
      clientName: 'Морозов Игорь',
      address: 'Москва, ул. Полярная, 34',
      status: 'new',
    },
  });

  console.log('Готово: 4 заявки (3 на карте, 1 в архиве, 1 без координат)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
