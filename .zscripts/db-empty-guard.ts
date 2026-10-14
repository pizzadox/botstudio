/**
 * DB Empty Guard — защита от обнуления БД платформенным снапшотом.
 *
 * Прецеденты (worklog): инцидент №1 (worklog:477, 08.10), №2 и №3 (13.10,
 * op-db-restore-pizzadox-pass), №4 (14.10). Платформа периодически
 * восстанавливает контейнер из своего снапшота и обнуляет db/custom.db —
 * данные (пользователи/боты/заявки/КП) теряются, пароли «слетают».
 *
 * Что делает:
 *   1. Считает записи в таблице User.
 *   2. Если users > 0 — БД жива, выход без действий (exit 0).
 *   3. Если users == 0 — БД пуста: ищем свежайший снапшот в db/snapshots/*.db,
 *      бэкапим пустой файл в db/custom.db.empty-bak-<ts>, копируем снапшот
 *      в db/custom.db, чистим -wal/-shm, прогоняем `bun run db:push`
 *      (выравнивание схемы снапшота с текущей).
 *
 * ВАЖНО: если нужен ИСКРЕННЕ пустой старт (новый проект) — временно уберите
 * db/snapshots/*.db из каталога, иначе гард восстановит последние данные.
 *
 * Вызывается из .zscripts/dev.sh ПОСЛЕ db:push (клиент Prisma уже сгенерён).
 * Отдельный запуск: bun .zscripts/db-empty-guard.ts
 */
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const DB_PATH = path.join(ROOT, 'db', 'custom.db');
const SNAPSHOTS_DIR = path.join(ROOT, 'db', 'snapshots');

function log(msg: string): void {
  const line = `[db-guard ${new Date().toISOString()}] ${msg}`;
  console.log(line);
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  let users = -1;
  try {
    users = await db.user.count();
  } catch (e) {
    log(`count failed (${String(e)}) — БД могла быть без таблиц; считаем пустой`);
  } finally {
    await db.$disconnect().catch(() => {});
  }

  if (users > 0) {
    log(`OK: users=${users} — восстановление не требуется`);
    return;
  }

  log(`users=${users} — БД ПУСТА, ищу снапшот для восстановления`);

  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    log('НЕТ db/snapshots/ — восстанавливать не из чего, выхожу');
    process.exit(1);
  }
  const snaps = fs
    .readdirSync(SNAPSHOTS_DIR)
    .filter((f) => f.endsWith('.db') && f.startsWith('snapshot-'))
    .map((f) => ({ f, m: fs.statSync(path.join(SNAPSHOTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (snaps.length === 0) {
    log('НЕТ подходящих снапшотов — выхожу');
    process.exit(1);
  }
  const src = path.join(SNAPSHOTS_DIR, snaps[0].f);
  log(`свежайший снапшот: ${snaps[0].f}`);

  // бэкап пустой БД (для расследования инцидентов)
  try {
    const bak = `${DB_PATH}.empty-bak-${Date.now()}`;
    if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, bak);
    log(`пустая БД забэкаплена: ${path.basename(bak)}`);
  } catch (e) {
    log(`бэкап пустой БД не удался (не критично): ${String(e)}`);
  }

  // восстановление: копия снапшота + чистка wal/shm
  fs.copyFileSync(src, DB_PATH);
  for (const suffix of ['-wal', '-shm']) {
    const p = `${DB_PATH}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  log('снапшот скопирован в db/custom.db, -wal/-shm почищены');

  // выравнивание схемы снапшота с текущей
  try {
    execSync('bun run db:push', { cwd: ROOT, stdio: 'inherit' });
    log('db:push — схема выровнена');
  } catch (e) {
    log(`db:push ПОСЛЕ восстановления упал: ${String(e)}`);
    process.exit(1);
  }

  // контроль: пользователи вернулись
  const db2 = new PrismaClient();
  try {
    const restored = await db2.user.count();
    log(`ВОССТАНОВЛЕНО: users=${restored}`);
  } finally {
    await db2.$disconnect().catch(() => {});
  }
}

main().catch((e) => {
  log(`НЕПРЕДВИДЕННАЯ ОШИБКА: ${String(e)}`);
  process.exit(1);
});
