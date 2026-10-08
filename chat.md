# chat.md — постоянный рабочий протокол проекта BotStudio

> **ПРАВИЛО №1:** этот файл читается ПЕРЕД выполнением КАЖДОГО запроса пользователя.
> **ПРАВИЛО №2:** по запросу определяются применимые скиллы из таблицы ниже, их `SKILL.md`
> читается полностью, инструкции применяются. Если скилл не применим — это фиксируется в ответе.
> **ПРАВИЛО №3:** любая нетривиальная работа идёт через ОРКЕСТРАТОРА (декомпозиция → параллельные
> агенты → Reviewer-агент ВСЕГДА параллельно имплементации → верификация → коммит).

## 1. Скиллы проекта (`/home/z/my-project/skills/`) — когда какой применять

| Скилл | Путь (SKILL.md) | Когда применять |
|---|---|---|
| **Agent Team Orchestration** (ОРКЕСТРАТОР) | `skills/@zuoyunlai/agent-team-orchestration/` | Любая задача из >3 шагов: роли, декомпозиция, параллельные агенты, handoff, ревью-воркфлоу |
| **Code Review** (Reviewer-агент) | `skills/@carolz1/code-review/` | ВСЕГДА запускать reviewer-агента параллельно с имплементацией (требование пользователя) |
| **Systematic Debugging** | `skills/superpowers-systematic-debugging/` | Любой баг/ошибка: root cause ДО фикса, фазы воспроизведения→гипотезы→проверки |
| **React Best Practices** | `skills/react-best-practices/` | Любая правка React/Next.js компонентов, состояние, эффекты, рендер |
| **UI/UX Pro Max** | `skills/ui-ux-pro-max/` | Любая UI-задача: layout, цвет, типографика, responsive, мобильная адаптация |
| **Visual Design Foundations** | `skills/visual-design-foundations/` | Дизайн-ревью вёрстки, визуальная целостность, шрифты/сетка/контраст |
| **Fullstack Dev** | `skills/fullstack-dev/` | Новые фичи «фронт+бэк+БД»: порядок «сначала фронт», API-роуты, Prisma |
| **Proactive Agent Lite** | `skills/proactive-agent-lite/` | Память между сессиями, проактивные уточнения, самовосстановление |
| **Persistent Memory Engine** | `skills/persistent-memory-engine-free/` | Долговременная память решений/контекста проекта |
| **Multi-Agent Dev (free)** | `skills/multi-agent-dev-free/` | Разделение работы между несколькими агентами, непересекающиеся зоны |
| **Web Search / Web Reader** (встроенные) | Skill tool: `web-search`, `web-reader` | Свежая документация библиотек, проверка внешних API (Nominatim, MAX, Telegram) |
| **Charts / PDF / DOCX / XLSX / PPTX** (встроенные) | Skill tool | Отчёты, выгрузки, документы по запросу пользователя |
| **Geocode / Location** (встроенные) | Skill tool: `geocode`, `location-service` | Проверка координат, обратное геокодирование, дистанции |
| **Image Generation / Edit** (встроенные) | Skill tool | Иконки, иллюстрации, OG-изображения по запросу |
| **Skill Finder** | `skills/skill-finder-cn/` + `clawhub search "<q>"` | Найти/доустановить скилл: `clawhub install @owner/skill` |

Полный список установленных: `ls /home/z/my-project/skills/`.

## 2. ОРКЕСТРАТОР — стандартный конвейер работы

```
Запрос → чат.md (этот файл) → выбор скиллов
  → 1. АУДИТ: 2-3 Explore-агента параллельно (research only, зоны не пересекаются)
  → 2. БЭКЛОГ: приоритизированный список IMP-<волна>-<NN>
  → 3. ИНФРА: общие файлы/пакеты ставит ИНТЕГРАТОР ДО запуска агентов (без конфликтов)
  → 4. БАТЧИ: 2-4 агента параллельно, у каждого СТРОГИ непересекающийся набор файлов-владений
       ПАРАЛЛЕЛЬНО с ними — Reviewer-агент (skills/@carolz1/code-review) по факту появления кода
  → 5. ИНТЕГРАЦИЯ: tsc --noEmit, bun run lint, dev.log без ошибок
  → 6. ВЕРИФИКАЦИЯ: agent-browser golden path (мобайл 390px + десктоп, светлая/тёмная тема)
  → 7. ФИКСЫ из отчёта Reviewer → повторная верификация
  → 8. КОММИТ + ПУШ (GitHub), worklog.md, docs/IMPROVEMENTS.md, отчёт пользователю
```

Правила агентов:
- Каждый агент: Task ID (например `23-BE`), читает `/home/z/my-project/worklog.md` ДО работы,
  добавляет свою секцию в worklog.md ПОСЛЕ работы (шаблон `--- / Task ID / Agent / Task / Work Log / Stage Summary`).
- Маркеры правок в коде: `// IMP-23-NN: <что сделано>`.
- Агенты НЕ перезапускают dev-сервер, НЕ запускают `bun run build`, НЕ делают git-операций.
- Конфликт файлов = ошибка планирования: пересечения зон не допускаются; общую инфраструктуру
  (пакеты, схема БД, общие константы, API-контракты) задаёт интегратор в промптах обоих агентов.

## 3. Инфраструктура проекта (шпаргалка)

- **Стек**: Next.js 16 App Router (SPA на `/`), TypeScript, Tailwind 4 + shadcn/ui, Prisma+SQLite
  (`db/custom.db`), maplibre-gl 6 + OpenFreeMap, bun. Пользовательские маршруты: только `/` и `/w/[secret]`.
- **Dev-сервер**: `setsid bash .zscripts/dev.sh` (порт 3000, лог `/home/z/my-project/dev.log`).
  Проверка: `curl -s -m 3 http://localhost:3000/api/health`.
- **Схема БД**: правка `prisma/schema.prisma` → `bun run db:push`. После смены схемы нужен рестарт
  dev-сервера (клиент в памяти) — делает ИНТЕГРАТОР.
- **Снапшоты БД**: `db/snapshots/snapshot-YYYY-MM-DD-HHMM.db` перед каждой волной (+ копия в `/tmp/my-project/db/`).
- **Секреты**: `.env.local` (APP_SECRET, TRUST_PROXY=1, GitHub-токен). НЕ коммитится.
- **Push**: `bash download/push.sh "<message>"` (не создаёт пустых коммитов) или `git push origin main`.
- **Пользователь видит только Preview Panel** (не localhost) — в ответах ссылаться на Preview Panel / «Открыть в новой вкладке».
- **Навыки SDK** (z-ai-web-dev-sdk) — ТОЛЬКО на бэкенде; фронт ходит через `/api/*`.
- **Мини-сервисы**: `mini-services/<name>/` (свой порт, `bun --hot`), фронт обращается
  `fetch('/api/...?XTransformPort=<port>')` — порт в URL запрещён.

## 4. Продукт BotStudio — предметная память

- Визуальный редактор ботов техподдержки (MAX / Telegram / WhatsApp / web-виджет `/w/[secret]`)
  + чат с оператором (инбокс) + заявки на вывоз отходов/КГМ с картой + интеграция MyTKO
  (реестр КП ~11 000 площадок, отчёты водителей, синк статусов). Сервис: Новгородская область.
- Сценарий-пример «Экосити» (71 узел) в БД; ветка жалоб: `n_complaint → n_cmp_menu → n_cmp_desc
  → n_cmp_when → n_cmp_done` (типы: не вывезли / повреждён контейнер / переполнена / другая).
- Журнал волн: `docs/IMPROVEMENTS.md` (волны 20-22 закрыты, 47+46+47 IMP), история — `worklog.md`.
- Гео-пайплайн: `src/lib/orders.ts` (Nominatim, кэш LRU 500), `composeAddress` в `src/lib/cities.ts`,
  ручная точка и перепроверка — `PATCH /api/bots/[id]/orders/[orderId]` (`{lat,lng}` / `{geocode:true}`).
- Известные demo-заявки №1-6 — Москва (тестовые данные, не трогать без запроса).

## 5. Чек-лист перед ответом «готово»

- [ ] chat.md прочитан, применимые скиллы использованы (или обоснован отказ)
- [ ] Reviewer-агент отработал параллельно, его замечания закрыты
- [ ] `bunx tsc --noEmit` = 0, `bun run lint` = 0, dev.log без ошибок
- [ ] agent-browser: golden path пройден (десктоп + 390px, светлая + тёмная тема)
- [ ] worklog.md и docs/IMPROVEMENTS.md дополнены
- [ ] Коммит запушен на GitHub
