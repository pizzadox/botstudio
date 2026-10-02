import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const bots = await db.bot.findMany({
  select: { id: true, name: true, status: true, userId: true, aiConfig: true, _count: { select: { conversations: true } } },
  orderBy: { updatedAt: 'desc' },
});
const users = await db.user.findMany({ select: { id: true, username: true } });
for (const b of bots) {
  const u = users.find((x) => x.id === b.userId);
  console.log(`${b.name} | ${b.status} | owner=${u?.username} | convs=${b._count.conversations} | ai=${b.aiConfig} | id=${b.id}`);
}
await db.$disconnect();
