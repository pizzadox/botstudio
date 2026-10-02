import { db } from '@/lib/db';
async function main() {
  const u = await db.user.findUnique({ where: { username: 'qa-geo' } });
  if (u) {
    await db.user.delete({ where: { id: u.id } });
    console.log('qa-geo удалён (каскадом бот и заявки)');
  } else {
    console.log('qa-geo не найден');
  }
  const g = await db.user.findUnique({ where: { username: 'e2e-geo' } });
  if (g) { await db.user.delete({ where: { id: g.id } }); console.log('e2e-geo удалён'); }
}
main().then(() => process.exit(0));
