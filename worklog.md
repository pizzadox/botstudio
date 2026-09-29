# Worklog — Visual Bot Studio (конструктор ботов для мессенджеров)

Проект: визуальный редактор ботов техподдержки (MAX / Telegram / WhatsApp и др.)
Стек: Next.js 16 + TypeScript + Tailwind 4 + shadcn/ui + Prisma/SQLite + @xyflow/react + z-ai-web-dev-sdk (LLM-навык).

---
Task ID: 0
Agent: main
Task: Планирование и инициализация

Work Log:
- Изучена структура проекта (Next.js 16, App Router, shadcn/ui, Prisma настроен).
- Загружен LLM-навык (z-ai-web-dev-sdk) — будет использоваться в AI-узлах ботов (backend only).
- Установлен @xyflow/react@12 для визуального редактора.
- Определена архитектура: auth (логин/пароль + сессии в БД), оркестратор сценариев (flow engine), вебхуки мессенджеров, симулятор чата, инбокс оператора.

Stage Summary:
- Схема БД: User, Session, Bot (flow JSON), Channel (telegram/whatsapp/max/web), Conversation, Message.
- Одностраничное SPA: / — единственный маршрут, вход через логин/пароль.

---
Task ID: 1
Agent: main
Task: Схема БД + ядро (типы flow, оркестратор, auth, LLM)

Work Log:
- prisma/schema.prisma: User, Session, Bot (flow JSON), Channel (telegram/whatsapp/max/web, secret для вебхука), Conversation (state JSON, needsOperator), Message. db:push успешно.
- src/lib/flow-types.ts: 10 типов узлов (start/message/question/buttons/condition/ai/http/delay/handoff/end), EngineState (память: vars + history), NODE_META.
- src/lib/flow-engine.ts: оркестратор runEngine() — traversal сценария, ожидание ввода/кнопок, подстановка {{переменных}}, условия, ИИ-узлы через z-ai-web-dev-sdk (с памятью и базой знаний), HTTP-запросы, передача оператору; defaultFlow() — готовый шаблон бота.
- src/lib/auth.ts: scrypt-хеши, сессии в БД, httpOnly cookie (bstudio_session).
- src/lib/webhook.ts: processInbound() — единая точка приёма сообщений из мессенджеров.
- src/lib/llm-навык используется внутри flow-engine (ZAI.create → chat.completions).

Stage Summary:
- Оркестратор выполняет алгоритмы: ожидание ввода, ветвления по кнопкам/условиям, ИИ-ответы с памятью.
- Вебхуки: /api/webhook/{telegram|whatsapp|max|demo}/[secret].

---
Task ID: 2
Agent: main
Task: API маршруты + фронтенд студии

Work Log:
- API: auth (register/login/logout/me), /api/bots CRUD+stats, /api/bots/[id] (GET/PUT/DELETE, flow валидация), /api/bots/[id]/simulate (stateless симулятор), /api/bots/[id]/channels, /api/channels/[id] (PUT/DELETE) + /test (реальный getMe для Telegram), /api/bots/[id]/conversations, /api/conversations/[id] (+operator, close), вебхуки telegram (sendMessage обратно), whatsapp (Cloud API формат), max (botapi.max.ru), demo (POST + GET polling).
- Фронтенд (SPA на /): app-root (auth gate + навигация), login-view (вход/регистрация), shell (сайдбар/мобильный хедер), dashboard (5 стат-карточек, создание/переименование/удаление ботов), editor-view (React Flow v12: drag&drop палитра, кастомные узлы с хендлами для кнопок/условий, инспектор свойств, автосохранение, публикация, MiniMap, snap-to-grid), test-chat (симулятор с кнопками и typing), channels-view (подключение каналов, webhook URL + copy, проверка, инструкции, демо-виджет чата с polling ответов оператора), inbox-view (список диалогов, badges «нужен оператор», ответ оператора, закрытие обращения).
- Тема: primary → emerald, кастомные скроллбары, lang=ru.
- ESLint: 0 ошибок.

Stage Summary:
- Полный цикл: бот создаётся → редактируется визуально → тестируется в симуляторе → публикуется → принимает сообщения через вебхуки → диалоги видны в инбоксе.

---
Task ID: 3
Agent: main + agent-browser
Task: End-to-end верификация через Agent Browser и исправления

Work Log:
- Зарегистрирован пользователь (логин/пароль), создан бот «Поддержка TechCorp» — сценарий-шаблон отрисовался на канвасе.
- Симулятор: приветствие → меню-кнопки → ИИ-узел (реальный ответ LLM) → передача оператору. Всё работает.
- Публикация бота переключателем → подключён веб-канал → демо-чат.
- НАЙДЕН И ИСПРАВЛЕН БАГ: демо-чат терял диалог (processInbound искал по externalId, а виджет передавал DB id) — добавлена поддержка conversationId в InboundMessage, fallback externalId для новых диалогов, кнопки меню в ответах API.
- Проверен round-trip: посетитель → «Оператор» → инбокс (badge «нужен оператор») → ответ оператора → посетитель видит ответ (localStorage restore + polling).
- Инспектор узлов: редактирование текста обновляет узел на канвасе, автосохранение (PUT 200), индикатор «Сохранено».
- Мобильная вёрстка (390px): bottom-sheet инспектор, палитра-лента, мобильная навигация.
- Исправлена a11y-ошибка (DialogTitle в демо-диалоге через VisuallyHidden).
- ESLint: 0 ошибок; dev.log без runtime-ошибок.

Stage Summary:
- Все ключевые сценарии проверены в реальном браузере: авторизация, конструктор, симулятор, ИИ, публикация, каналы, демо-чат, инбокс оператора.
