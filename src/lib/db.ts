import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  __prismaPragmasDone?: boolean
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // SQL-лог только в dev: в production он льёт тысячы строк и ест CPU
    log: process.env.NODE_ENV === 'production' ? [] : ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// SQLite: WAL + busy_timeout — меньше ошибок «database is locked» под нагрузкой
// и быстрее чтение при параллельной записи. Один раз на процесс (глобальный флаг
// защищает от повторного запуска при HMR/двойной регистрации instrumentation).
if (!globalForPrisma.__prismaPragmasDone) {
  globalForPrisma.__prismaPragmasDone = true
  void db
    .$connect()
    .then(() => db.$executeRawUnsafe('PRAGMA journal_mode=WAL;'))
    .then(() => db.$executeRawUnsafe('PRAGMA busy_timeout=5000;'))
    .catch(() => {
      // не критично: приложение работает и без WAL
    })
}
