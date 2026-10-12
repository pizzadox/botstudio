# Конвенции BotStudio (память для агентов)

## Стек
Next.js 16 App Router (единственный публичный маршрут `/`, SPA из `src/components/studio/*`), TypeScript strict, Tailwind 4 + shadcn/ui (New York), Prisma + SQLite (`db/custom.db`), maplibre-gl + OpenFreeMap, z-ai-web-dev-sdk — ТОЛЬКО на бэкенде. API-роуты, не server actions. Bun, порт 3000, `bun run dev` через `setsid bash .zscripts/dev.sh`.

## Дизайн-система
- Радиусы: карточки/панели `rounded-xl`, мелкие чипы/кнопки `rounded-lg` или `rounded-full`, цветные кружки иконок `rounded-lg bg-primary/10 text-primary` (или цвет/10).
- Тени: `shadow-sm` покой, `hover:shadow-md` ховер. ЗАПРЕЩЕНЫ hover:scale / hover:w-* (геометрические анимации).
- Заголовки view (h1): `text-lg sm:text-2xl font-bold tracking-tight`. Числа-счётчики: `tabular-nums`.
- Пузыри чатов: клиент `bg-muted rounded-2xl rounded-bl-md`, бот `border bg-card rounded-br-md`, оператор `bg-primary text-primary-foreground`; `max-w-[85%] sm:max-w-[75%]`; фон `bg-muted/40`; время `text-[10px]`.
- Цветные бейджи/чипы ВСЕГДА с dark-парой: `bg-*-500/15 text-*-300 border-*-500/30` (light: `bg-*-100 text-*-700 border-*-200`).
- Скелетоны вместо «Загрузка…» (`Skeleton` + `role="status"` + sr-only текст), сетки скелетонов совпадают с реальными.
- Пустые состояния: иконка в `h-12 w-12 rounded-xl bg-primary/10 text-primary` + font-medium заголовок + text-sm muted пояснение + CTA-кнопка.
- Фокус: `focus-visible:ring-2 focus-visible:ring-ring` (иногда ring-offset-2); aria-label на иконок-кнопках; aria-current/aria-pressed/aria-live где уместно.
- Тач-таргеты ≥ 44px (h-10/h-11), мобайл-проверка 390px без горизонтального скролла.

## Поведение
- Опасные удаления (канал/бот/запись БЗ) — через shadcn AlertDialog.
- Поллинг: пауза на `document.hidden`, дедуп-слияние сообщений по id, `?take=N` (бэкенд поддерживает), индикатор свежести данных.
- Сохранение UI-состояния (вкладки/фильтры) в localStorage ключи `bstudio.*`.
- Тосты через существующий use-toast (radix Toaster в layout.tsx).

## Бэкенд
- Prisma: списки — `select` только нужного; `take` обязателен на растущих списках; новые индексы через schema.prisma + `bun run db:push`.
- Сообщения GET:orderBy desc + reverse (НЕ asc+take — отдаёт самые старые).
- Nominatim ≤ 1 req/s, UA обязателен. MyTKO: токен в `id_token`, GraphQL-401 приходит в body с HTTP 200.
- SQLite: включён WAL (db.ts). `log: ['query']` только в dev.
- tsc должен быть чистым по `src/**` (download/ исключён из tsconfig).

## БД-безопасность
- БД коммитится снапшотами в `db/snapshots/` (git-tracked) + копия в `/tmp/my-project/db/`. Хелпер `bash download/db-snapshot.sh`.
- Восстановление: `cp db/snapshots/<свежий>.db db/custom.db && bun run db:push`, перезапуск через `.zscripts/dev.sh`.
- Пароль pizzadox = asd78963 (scrypt salt:hash как в src/lib/auth.ts).
