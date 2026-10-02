import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const channels = await db.channel.findMany({
    select: { id: true, botId: true, type: true, title: true, active: true, lastStatus: true, secret: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log('=== CHANNELS ===');
  for (const c of channels) {
    console.log(JSON.stringify({ ...c, createdAt: c.createdAt.toISOString() }));
  }

  const bots = await db.bot.findMany({
    select: { id: true, userId: true, name: true, status: true },
  });
  console.log('=== BOTS ===');
  for (const b of bots) console.log(JSON.stringify(b));

  const convs = await db.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 40,
    include: { messages: { orderBy: { createdAt: 'asc' }, select: { id: true, role: true, text: true, createdAt: true, externalKey: true } } },
  });
  console.log('=== CONVERSATIONS (last 40) ===');
  for (const c of convs) {
    console.log(JSON.stringify({
      id: c.id,
      botId: c.botId,
      source: c.source,
      externalId: c.externalId,
      contact: c.contact,
      needsOperator: c.needsOperator,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      msgCount: c.messages.length,
      messages: c.messages.map((m) => ({
        role: m.role,
        text: m.text.slice(0, 60),
        at: m.createdAt.toISOString(),
        key: m.externalKey,
      })),
    }));
  }
}

main().finally(() => db.$disconnect());
