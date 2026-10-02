const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const users = await db.user.findMany({ include: { bots: { include: { channels: true } } } });
  for (const u of users) {
    console.log(`\n=== USER: ${u.username} (${u.id}) ===`);
    for (const b of u.bots) {
      console.log(`  BOT: "${b.name}" id=${b.id} status=${b.status}`);
      for (const c of b.channels) {
        console.log(`    CH: type=${c.type} title="${c.title}" active=${c.active} lastStatus=${c.lastStatus ? c.lastStatus.slice(0,80) : null}`);
      }
      const flow = JSON.parse(b.flow || '{}');
      const nodes = flow.nodes || [];
      console.log(`    FLOW: ${nodes.length} nodes: ${nodes.map(n => n.id).join(', ')}`);
    }
  }
  await db.$disconnect();
})();
