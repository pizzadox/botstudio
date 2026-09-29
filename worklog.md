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

---
Task ID: 4
Agent: main
Task: Исправление аутентификации: «требуется авторизация» при создании бота, потеря сессии после перезагрузки

Work Log:
- Диагноз: приложение открывается в iframe предпросмотра — браузер блокирует сторонние cookie (SameSite=Lax), поэтому cookie bstudio_session не сохранялся/не отправлялся; сессии при этом корректно создавались в БД.
- Решение — двойная схема auth: cookie + Bearer-токен в localStorage.
- src/lib/auth.ts: getTokenFromRequest() — токен из заголовка Authorization: Bearer (приоритет) или cookie; getSessionUser/destroySession обновлены.
- /api/auth/login и /api/auth/register теперь возвращают token сессии в ответе.
- src/lib/client-api.ts: getAuthToken/setAuthToken/clearAuthToken (localStorage), каждый запрос шлёт Authorization; при 401 вне форм входа — сброс токена + событие bstudio:unauthorized.
- app-root.tsx: слушатель bstudio:unauthorized → экран входа; logout очищает localStorage. login-view.tsx: сохранение токена после входа/регистрации.
- Создан демо-аккаунт: логин demo, пароль demo123 (сброс через seed-скрипт при повторном запуске).
- Проверено curl: login → token, /api/auth/me с Bearer → 200, POST /api/bots с Bearer → 200.
- Проверено agent-browser: вход demo/demo123 → создание бота «Демо-бот поддержки» → перезагрузка страницы → сессия сохранена, бот на дашборде, ошибок в консоли нет.

Stage Summary:
- Аутентификация устойчива к блокировке cookie (iframe): работает через Bearer-токен в localStorage, cookie сохранён как fallback.
- Аккаунты в БД: alex, pizzadox (пароли хешированы, восстановлению не подлежат), demo / demo123.

---
Task ID: 5
Agent: main
Task: Передача оператору из тестового чата + аудит мобильной вёрстки

Work Log:
- БАГ (test chat → оператор): симулятор был stateless — needsOperator возвращался, но в БД ничего не писалось, инбокс был пуст.
- flow-engine.ts: после передачи оператору бот молчит на последующие сообщения пользователя (в начало «нового диалога» добавлена проверка needsOperator).
- simulate/route.ts: при достижении узла «Оператор» диалог материализуется в БД (source=simulator, contact=Тест-чат, вся история из state.history как Message); режим conversationId — сообщения пишутся в БД, ответы возвращаются с id; needsOperator=true.
- close/route.ts: при закрытии обращения очищается vars.__operator и сбрасывается позиция — бот возобновляет сценарий.
- test-chat.tsx: режим оператора — баннер «Диалог передан оператору» + кнопка «Открыть» (переход в инбокс), опрос /api/conversations/[id] каждые 2.5с, сообщения оператора с меткой 🎧, восстановление диалога из localStorage (botstudio_test_conv_{botId}) при повторном открытии, состояние «оператор закрыл обращение», сброс очищает связь.
- editor-view.tsx: прокинут onOpenInbox (app-root → editor → test-chat); мобильные Sheet получили VisuallyHidden SheetTitle/SheetDescription (a11y Radix); у тест-чата скрыт встроенный крестик Sheet (двойной X).
- ЛЕЙАУТ: shell.tsx переведён на каркас h-dvh overflow-hidden + min-h-0 — раньше страница скроллилась целиком, канвас растягивался, поле ввода тест-чата и быстрые кнопки уходили под нижний край. Dashboard/channels скроллятся внутри (overflow-y-auto), редактор/инбокс фиксированной высоты.
- shell.tsx: тач-зоны мобильной навигации h-9→h-10; dashboard/channels: min-h-0 + overflow-y-auto.
- sheet.tsx: data-slot="sheet-close" для точечного скрытия.
- Проверено браузером (desktop 1280 + mobile 390): полный цикл оператора (нажать «Оператор» → баннер → инбокс с бейджем «нужен оператор» → ответ оператора → метка 🎧 в тест-чате), восстановление диалога после смены вида, очистка обращений работает (бот снова отвечает), inspector-sheet, палитра-лента, диалог каналов, логин (footer sticks to bottom), cookies+localStorage двойная auth.
- Примечание: у agent-browser сломалась дефолтная сессия (реальные клики не доходили до страницы, события глотались) — помогла новая изолированная сессия (--session fix1); к коду приложения отношения не имеет.
- React Flow warning #004 (parent dimensions) — транзиентный, контейнер 390×622 замерен, канвас работает.

Stage Summary:
- Симулятор и инбокс оператора связаны: «позвать оператора» в тестовом чате создаёт реальное обращение; оператор отвечает, переписка двусторонняя; закрытие обращения возвращает управление боту.
- Исправлен каркас высоты приложения (h-dvh) — чат/канвас/инпут всегда в пределах экрана на десктопе и мобильных.
- a11y: все Sheet имеют заголовки; тач-зоны ≥40px.
