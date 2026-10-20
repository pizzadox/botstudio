# chat.md — постоянный рабочий протокол проекта BotStudio

> **ПРАВИЛО №1:** этот файл читается ПЕРЕД выполнением КАЖДОГО запроса пользователя.
> **ПРАВИЛО №2:** по запросу определяются применимые скиллы из реестра ниже, их `SKILL.md`
> читается полностью, инструкции применяются. Если скилл не применим — это фиксируется в ответе.
> **ВСЕГДА включать:** ПАМЯТЬ (self-improving/ontology) · ОРКЕСТРАТОР · агентов (декомпозиция +
> параллельные батчи + Reviewer) · UI UX Pro Max / Taste / Hallmark — при любой UI-задаче ·
> find-skills — если нужного скилла нет в реестре.
> **ПРАВИЛО №3:** любая нетривиальная работа идёт через ОРКЕСТРАТОРА (декомпозиция → параллельные
> агенты → Reviewer-агент ВСЕГДА параллельно имплементации → верификация → коммит).

## 1. Реестр скиллов (`/home/z/my-project/skills/`) — когда какой применять

Установка: `clawhub install <slug>` (нативные `@owner/slug`) или GitHub-fallback: клон → копия
каталога со SKILL.md в `skills/<name>/` (registry-баг v0.23.3 «skills-sh: hash mismatch» —
прецедент и карта установки: worklog, секция 30-A1). Поиск новых: `clawhub search "<q>"`.

### 1a. Ядро — ПАМЯТЬ, ОРКЕСТРАТОР, АГЕНТЫ (всегда включать)

| Скилл | Путь (SKILL.md) | Когда применять |
|---|---|---|
| **Agent Team Orchestration** (ОРКЕСТРАТОР) | `skills/@zuoyunlai/agent-team-orchestration/` | Любая задача из >3 шагов: роли, декомпозиция, параллельные агенты, handoff, ревью-воркфлоу |
| **Agent Team Orchestration v2** | `skills/@arminnaimi/agent-team-orchestration/` | Дубль основной версии: сверять lifecycle (inbox→spec→build→review→done) и quality gates при спорах |
| **Subagent-Driven Development** | `skills/subagent-driven-development/` | Большие волны: работа ТОЛЬКО сабагентами с зонами, интегратор не пишет код |
| **Code Review** (Reviewer-агент, carolz1) | `skills/@carolz1/code-review/` | ВСЕГДА запускать reviewer-агента параллельно имплементации (требование пользователя) |
| **Code Review** (mattpocock) | `skills/code-review/` | Альтернативная методология ревью (двухосевое Standards/Spec) — можно объединять |
| **Self-Improving** (ПАМЯТЬ) | `skills/@ivangdavila/self-improving/` | После значимой работы/ошибки: само-рефлексия, урок в `~/self-improving/memory.md`. В конце волны — обязательно |
| **Ontology** (ПАМЯТЬ, граф знаний) | `skills/@oswalpalash/ontology/` | «Запомни, что…», связи Продукт↔КП↔Экипаж↔Заявка, «что я знаю о X» |
| **Proactive Agent Lite** (bestrocky) | `skills/@bestrocky/proactive-agent-lite/` | Перед планированием волны: reverse prompting, самовосстановление, alignment |
| **Persistent Memory Engine** | `skills/persistent-memory-engine-free/` | Долговременная память решений/контекста проекта |
| **Elite Longterm Memory** | `skills/@nextfrontierbuilds/elite-longterm-memory/` | ⚠️ Нужен OPENAI_API_KEY + memory-lancedb — без них фиксировать отказ; WAL-паттерн применять |
| **Capability Evolver** | `skills/@autogame-17/evolver/` | ⚠️ Нужен A2A_NODE_ID — только по явной просьбе пользователя |
| **Productivity** | `skills/@ivangdavila/productivity/` | Диагностика рабочих процессов пользователя; к коду не применяется |

### 1b. Дизайн / UI / UX (любая UI-задача)

| Скилл | Путь (SKILL.md) | Когда применять |
|---|---|---|
| **UI/UX Pro Max** | `skills/ui-ux-pro-max/` (v2.15.0) | ЛЮБАЯ UI-задача: layout, цвет, типографика, responsive, мобильная адаптация, тач-таргеты |
| **Frontend Design** (anthropics) | `skills/frontend-design/` | Компоненты/страницы с нуля, визуальный полиш, дизайн-системы |
| **Web Design Guidelines** (vercel-labs) | `skills/web-design-guidelines/` | Чек-листы качества вёрстки: доступность, консистентность, интеракции |
| **Design Taste Frontend** (Taste) | `skills/design-taste-frontend/` | Вкус: ритм, иерархия, детализация — полиш готовых экранов |
| **Hallmark** | `skills/hallmark/` | Анти-«AI-slop»: убрать безвкусицу, сгенерировать характерный дизайн (v1.1.0) |
| **Impeccable** | `skills/impeccable/` | Крафтовое качество UI: детали, микро-анимации, состояния |
| **Brandkit** | `skills/brandkit/` | Бренд-кит: палитра, логотип-пластика, фирменные элементы |
| **Image-to-Code** | `skills/image-to-code/` | Верстка по макету/скриншоту |
| **Theme Factory** (anthropics) | `skills/theme-factory/` | Темы/токены: светлая-тёмная пара, переменные |
| **Visual Design Foundations** | `skills/visual-design-foundations/` | Дизайн-ревью вёрстки, шрифты/сетка/контраст |
| **Prototype** | `skills/prototype/` | Быстрый прототип фичи до имплементации |
| **Shadcn UI** | `skills/shadcn-ui/` | Паттерны shadcn-компонентов (⚠️ MCP-инструменты `shadcn*` опциональны) |
| **FEC UI Design** | `skills/fec-ui-design/` (v2.9.0) | Доп. паттерны фронтенд-дизайна |

### 1c. Процессы разработки (планирование → имплементация → верификация)

| Скилл | Путь (SKILL.md) | Когда применять |
|---|---|---|
| **Brainstorming** (obra) | `skills/brainstorming/` | Расплывчатая идея от пользователя → проработка ДО кода |
| **Writing Plans** (obra) | `skills/writing-plans/` (v7.0.0) | План волны: декомпозиция на батчи с зонами |
| **Executing Plans** (obra) | `skills/executing-plans/` | Исполнение плана по шагам с контрольными точками |
| **Implement** (mattpocock) | `skills/implement/` | Имплементация фичи по спеке |
| **To-Spec** (mattpocock) | `skills/to-spec/` | Требования → формальная спека перед кодом |
| **To-Tickets** (mattpocock) | `skills/to-tickets/` | Спека → тикеты/батчи для агентов |
| **Domain Modeling** (mattpocock) | `skills/domain-modeling/` | Новые сущности предметной области (заявки, экипажи, КП) |
| **Codebase Design** (mattpocock) | `skills/codebase-design/` | Структурные изменения, границы модулей |
| **Improve Codebase Architecture** | `skills/improve-codebase-architecture/` | Рефакторинг-волны |
| **TDD** (mattpocock) | `skills/tdd/` | По явному запросу тестов (в проекте тесты не пишем по умолчанию) |
| **Verification-before-Completion** (obra) | `skills/verification-before-completion/` | ПЕРЕД словом «готово»: свежие доказательства (tsc/lint/браузер), не память |
| **Webapp Testing** (anthropics) | `skills/webapp-testing/` | E2E-прогон через Playwright/agent-browser (золотой путь) |
| **Handoff** (mattpocock) | `skills/handoff/` | Передача работы между агентами/сессиями (⚠️ redact secrets) |
| **Wayfinder** (mattpocock) | `skills/wayfinder/` | Ориентация в незнакомой части кодовой базы |
| **Find-Skills** (vercel-labs) | `skills/find-skills/` | Найти скилл под задачу: реестр → `clawhub search` → install |
| **Skill Creator** (anthropics) | `skills/skill-creator/` | Создание/тюнинг собственных скиллов, evals |
| **Teach** (mattpocock) | `skills/teach/` | Объяснения пользователю (onboarding, how-to) |

### 1d. Отладка / диагностика

| Скилл | Путь (SKILL.md) | Когда применять |
|---|---|---|
| **Systematic Debugging** (obra) | `skills/superpowers-systematic-debugging/` (v7.0.0) | ЛЮБОЙ баг: root cause ДО фикса, фазы воспроизведение→гипотезы→проверка |
| **Diagnosing Bugs** (mattpocock) | `skills/diagnosing-bugs/` | Компаньон: гипотезы по симтомам, дифф-диагностика |
| **Resolving Merge Conflicts** | — | ⚠️ Скилл удалён из upstream (mattpocock, «no longer needed») — конфликтуем по стандартному git-процессу |

### 1e. Документы, контент, маркетинг, прочее

| Скилл | Путь (SKILL.md) | Когда применять |
|---|---|---|
| **PDF / DOCX / XLSX / PPTX** | `skills/pdf/`, `docx/`, `xlsx/`, `pptx/` | Документы/отчёты/выгрузки (платформенные версии с доработками — НЕ перезаписывать anthropics-версиями) |
| **Doc Coauthoring** (anthropics) | `skills/doc-coauthoring/` | Совместное редактирование документов с пользователем |
| **MCP Builder** (anthropics) | `skills/mcp-builder/` | Создание MCP-серверов |
| **Web Artifacts Builder** (anthropics) | `skills/web-artifacts-builder/` | Самодостаточные HTML-артефакты |
| **SEO Audit** | `skills/seo-audit/` | Аудит SEO публичных страниц |
| **Copywriting** | `skills/copywriting/` | Тексты интерфейса, письма, лендинги |
| **Grill-Me / Grill-With-Docs** | `skills/grill-me/`, `grill-with-docs/` | Жёсткое интервью по решению ДО кода (защита от слабых планов) |
| **Triage** (mattpocock) | `skills/triage/` | Разбор потока багов/запросов в приоритеты |
| **Research** (mattpocock) | `skills/research/` | Исследование технологии/библиотеки перед выбором |
| **Supabase Postgres Best Practices** | `skills/supabase-postgres-best-practices/` | ⚠️ Для Postgres/Supabase; у нас SQLite+Prisma — применять только по аналогии |
| **Browser-Use** | `skills/browser-use/` | Альтернативная браузерная автоматизация (Python; основной инструмент — agent-browser) |
| **Ponytail** | `skills/ponytail/` | Код-ревью дизайн-долгов (серия ponytail-review/audit вне установки — ставить по необходимости) |
| **Web Search / Web Reader** (встроенные) | Skill tool | Свежая документация, проверка внешних API (Nominatim, MAX, Telegram) |
| **Charts / Geocode / Image Gen** (встроенные) | Skill tool | Отчёты, координаты, иллюстрации |
| **Graphify / Public APIs** | — | ⚠️ Не скиллы (библиотека/справочник без SKILL.md) — фиксировать отказ, подключать как пакеты при необходимости |

Полный список установленных (118 каталогов): `ls /home/z/my-project/skills/`.

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
