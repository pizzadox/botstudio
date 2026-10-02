/**
 * Демо-заявки для карты/архива бота «Экосити» (pizzadox).
 * Помечены комментарием «Демо-заявка…» — удаляются в карточке заявки.
 * Запуск: bun download/seed-demo-orders.ts
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const DEMO_MARK = 'Демо-заявка для демонстрации карты — можно удалить.';

async function main() {
  const bot = await db.bot.findFirst({ where: { user: { username: 'pizzadox' } } });
  if (!bot) throw new Error('Бот Экосити не найден');
  console.log('BOT:', bot.name, bot.id);

  const agg = await db.order.aggregate({ where: { botId: bot.id }, _max: { number: true } });
  let num = (agg._max.number ?? 0) + 1;
  console.log('Первый номер демо-заявки:', num);

  const mk = (daysAgo: number, hour = 10) => {
    const d = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
    d.setHours(hour, 12, 0, 0);
    return d;
  };

  // Клиент 1: Иванов Алексей — активная заявка с чатом + выполненная в архиве
  const conv = await db.conversation.create({
    data: {
      botId: bot.id,
      source: 'web',
      externalId: 'user:demo-seed-ivanov',
      externalUserId: 'demo-seed-ivanov',
      contact: 'Иванов Алексей',
      status: 'open',
    },
  });

  const o1 = await db.order.create({
    data: {
      botId: bot.id,
      conversationId: conv.id,
      externalUserId: 'demo-seed-ivanov',
      number: num++,
      type: 'waste',
      clientName: 'Иванов Алексей',
      phone: '+7 916 220-14-05',
      address: 'Москва, ул. Тверская, 15',
      size: '8 м³ (бункер)',
      wishDate: 'завтра до 12:00',
      status: 'new',
      lat: 55.7615,
      lng: 37.6094,
      comment: DEMO_MARK,
      createdAt: mk(0, 9),
    },
  });
  await db.message.create({
    data: {
      conversationId: conv.id,
      role: 'user',
      text: 'Здравствуйте! Подтвердите, пожалуйста, заявку — машина точно придёт завтра до 12?',
      orderId: o1.id,
      createdAt: mk(0, 9, ),
    },
  });
  await db.message.create({
    data: {
      conversationId: conv.id,
      role: 'bot',
      nodeId: '__operator',
      text: 'Добрый день, Алексей! Да, заявка №%d подтверждена — машина будет с 9:00 до 12:00. Контейнер выставьте с вечера.'.replace('%d', String(o1.number)),
      orderId: o1.id,
      createdAt: mk(0, 10),
    },
  });

  await db.order.create({
    data: {
      botId: bot.id,
      conversationId: conv.id,
      externalUserId: 'demo-seed-ivanov',
      number: num++,
      type: 'waste',
      clientName: 'Иванов Алексей',
      phone: '+7 916 220-14-05',
      address: 'Москва, ул. Тверская, 15',
      size: '0,8 м³ (стандарт)',
      wishDate: 'пн до 10:00',
      status: 'completed',
      lat: 55.7602,
      lng: 37.6112,
      comment: DEMO_MARK,
      createdAt: mk(9, 11),
      completedAt: mk(8, 15),
    },
  });

  // Клиент 2: Петрова Мария — выполненный КГМ + активная заявка
  await db.order.create({
    data: {
      botId: bot.id,
      externalUserId: 'demo-seed-petrova',
      number: num++,
      type: 'kgm',
      clientName: 'Петрова Мария',
      phone: '+7 903 711-48-22',
      address: 'Москва, ул. Профсоюзная, 42',
      size: 'диван, 2 мешка строймусора',
      wishDate: 'среда',
      status: 'completed',
      lat: 55.6725,
      lng: 37.5626,
      comment: DEMO_MARK,
      createdAt: mk(4, 12),
      completedAt: mk(3, 14),
    },
  });
  await db.order.create({
    data: {
      botId: bot.id,
      externalUserId: 'demo-seed-petrova',
      number: num++,
      type: 'waste',
      clientName: 'Петрова Мария',
      phone: '+7 903 711-48-22',
      address: 'Москва, ул. Профсоюзная, 42',
      size: '20 м³ (промышленный)',
      wishDate: 'пт до 9:00',
      status: 'assigned',
      assignee: 'Бригада №2',
      lat: 55.6701,
      lng: 37.5577,
      comment: DEMO_MARK,
      createdAt: mk(1, 13),
    },
  });

  // Клиент 3: Сидоров Пётр — в работе
  await db.order.create({
    data: {
      botId: bot.id,
      externalUserId: 'demo-seed-sidorov',
      number: num++,
      type: 'waste',
      clientName: 'Сидоров Пётр',
      phone: '+7 925 003-91-77',
      address: 'Москва, ул. Строителей, 8к2',
      size: '8 м³ (бункер), строймусор',
      wishDate: 'сегодня до 18:00',
      status: 'in_progress',
      assignee: 'Бригада №3 · водитель Крылов',
      lat: 55.6979,
      lng: 37.566,
      comment: DEMO_MARK,
      createdAt: mk(1, 8),
    },
  });

  // Клиент 4: Козлова Анна — отменена
  await db.order.create({
    data: {
      botId: bot.id,
      externalUserId: 'demo-seed-kozlova',
      number: num++,
      type: 'kgm',
      clientName: 'Козлова Анна',
      phone: '+7 910 455-30-18',
      address: 'Москва, ул. Академика Королёва, 12',
      size: 'холодильник, стиральная машина',
      wishDate: 'чт',
      status: 'cancelled',
      lat: 55.8225,
      lng: 37.5936,
      comment: 'Клиент отменил — вывезет самостоятельно. ' + DEMO_MARK,
      createdAt: mk(6, 16),
      completedAt: mk(5, 10),
    },
  });

  // Клиент 5: Морозов И. — без координат (панель «укажите точку на карте»)
  await db.order.create({
    data: {
      botId: bot.id,
      externalUserId: 'demo-seed-morozov',
      number: num++,
      type: 'waste',
      clientName: 'Морозов Игорь',
      phone: '+7 926 118-72-40',
      address: 'Москва, ул. Полярная, 34',
      size: '0,8 м³ (стандарт)',
      wishDate: 'на следующей неделе',
      status: 'new',
      comment: DEMO_MARK,
      createdAt: mk(0, 11),
    },
  });

  const total = await db.order.count({ where: { botId: bot.id } });
  console.log('Готово. Всего заявок у бота:', total);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
