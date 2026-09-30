const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const db = new PrismaClient();
(async () => {
  const src = await db.bot.findFirst({ where: { user: { username: 'pizzadox' } } });
  const demo = await db.user.findUnique({ where: { username: 'demo' } });
  fs.writeFileSync('download/twin-flow.json', src.flow, 'utf8');
  const twin = await db.bot.create({
    data: { userId: demo.id, name: 'E2E-Экосити (двойник)', description: 'Временный бот для визуальной проверки', status: 'published', flow: src.flow, aiConfig: src.aiConfig },
  });
  console.log('TWIN_ID=' + twin.id);
  await db.$disconnect();
})();
