/** Удаление демо-двойника после проверки UI. bun download/cleanup-demo-twin.ts */
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const user = await db.user.findUnique({ where: { username: 'demo' } });
if (user) {
  const r = await db.bot.deleteMany({ where: { userId: user.id, name: 'Экосити-двойник (проверка UI)' } });
  console.log('Удалено ботов-двойников:', r.count);
}
await db.$disconnect();
