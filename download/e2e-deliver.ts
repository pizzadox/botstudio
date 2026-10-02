/** Проверка deliverTextToConversation: MAX-диалог с фейковым токеном → внятная ошибка, без падений. */
import { PrismaClient } from '@prisma/client';
import { deliverTextToConversation } from '../src/lib/deliver';
import { maxSendMessage } from '../src/lib/max-api';

const db = new PrismaClient();

async function main() {
  const user = await db.user.create({ data: { username: `e2e-dlv-${Date.now()}`, password: 'x' } });
  const bot = await db.bot.create({
    data: { userId: user.id, name: 'E2E-DLV', status: 'published', flow: '{}' },
  });
  const channel = await db.channel.create({
    data: { botId: bot.id, type: 'max', title: 'e2e', token: 'fake-token-dlv', active: true },
  });
  const conv = await db.conversation.create({
    data: { botId: bot.id, channelId: channel.id, source: 'max', externalId: '999000111', externalUserId: '888000222' },
  });

  const res = await deliverTextToConversation(conv.id, 'Тест доставки оператора');
  console.log('deliver→max (fake token):', JSON.stringify(res));
  if (res.delivered === false && res.error) console.log('✅ путь MAX работает: ошибка токена возвращена, без исключений');
  else console.log('❌ неожиданный результат');

  const send = await maxSendMessage('fake-token-dlv', '999000111', 'тест');
  console.log('maxSendMessage (fake token):', JSON.stringify(send));

  // web-диалог: считается доставленным (polling клиента)
  const conv2 = await db.conversation.create({
    data: { botId: bot.id, source: 'web', externalId: 'guest-x', contact: 'Гость' },
  });
  const res2 = await deliverTextToConversation(conv2.id, 'тест web');
  console.log('deliver→web:', JSON.stringify(res2));
  console.log(res2.delivered ? '✅ web-диалог ок' : '❌ web-диалог сломан');

  await db.bot.delete({ where: { id: bot.id } });
  await db.user.delete({ where: { id: user.id } });
  console.log('Уборка выполнена');
}

main().finally(() => db.$disconnect());
