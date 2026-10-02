const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const bot = await db.bot.findFirst({ where: { user: { username: 'pizzadox' } }, include: { knowledge: true, channels: true } });
  console.log('BOT:', bot.name, bot.id, 'status:', bot.status);
  console.log('aiConfig:', bot.aiConfig);
  console.log('KB items:', bot.knowledge.length);
  for (const k of bot.knowledge) console.log('  -', k.title, '|', k.content.slice(0, 60));
  for (const c of bot.channels) console.log('CH:', c.id, c.type, c.title, 'active:', c.active);
  // conversations
  const convs = await db.conversation.findMany({ where: { botId: bot.id }, select: { id: true, source: true, externalUserId: true, needsOperator: true, status: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } });
  console.log('Conversations:', convs.length);
  for (const c of convs.slice(0, 8)) console.log('  conv:', c.id.slice(-6), c.source, 'uid:', c.externalUserId, 'op:', c.needsOperator, c.status, c.updatedAt.toISOString());
  await db.$disconnect();
})();
