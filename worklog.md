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

---
Task ID: 5
Agent: main
Task: Починить подключение бота MAX («мне не подключить никак бота макса») + пошаговая инструкция

Work Log:
- Диагностика: пользователь создал MAX-канал с валидным токеном, бот опубликован, но входящих 0 — механизм получения сообщений из MAX отсутствовал.
- Изучена актуальная документация dev.max.ru: токен теперь передаётся ТОЛЬКО в заголовке Authorization (query-параметр access_token больше не поддерживается); актуальный домен platform-api2.max.ru (из песочницы недоступен из-за сертификата Минцифры — UNABLE_TO_GET_ISSUER_CERT_LOCALLY), но botapi.max.ru полностью рабочий; Long Polling GET /updates (params: timeout 0-90, marker, types) + POST /messages?chat_id=...; вебхук требует ручной регистрации через POST /subscriptions (UI в MAX для этого нет — из-за этого пользователь и застрял).
- Создан src/lib/max-api.ts: клиент Bot API MAX (Authorization-заголовок, fallback доменов, maxGetMe/maxSendText/maxGetUpdates).
- Создан src/lib/max-poller.ts: фоновый приёмщик Long Polling для каждого активного MAX-канала (singleton через globalThis); sync-цикл каждые 5с подхватывает новые/останавливает удалённые каналы; игнорирует собственные сообщения бота (is_bot / user_id из /me); не отвечает на «висящие» сообщения старше 2 минут; троттлинг ответов 650мс (лимит MAX 2 msg/s/диалог); при 401 — статус в карточке канала + повтор через 30с с авто-подхватом нового токена (сброс marker при смене токена).
- Создан src/instrumentation.ts: register() запускает max-poller при старте Node-сервера (NEXT_RUNTIME === 'nodejs').
- /api/channels/[id]/test: для max — реальная проверка токена через GET /me, возвращает имя бота, пишет lastStatus.
- /api/webhook/max/[secret]: исправлен парсинг официального формата update.payload.message, отправка через Authorization-заголовок (maxSendText), GET-ответ для проверки URL подписки, игнор сообщений бота.
- channels-view.tsx: для MAX-каналов блок «Вебхук не нужен» вместо URL вебхука; пошаговая подсказка получения токена («MAX для бизнеса» / max.ru → Чат-боты → ⋮ → Настройки → копировать); дефолтное название канала «MAX-бот».
- Верификация: bun run lint чисто; token пользователя проверен (200 /me, бот «Поддержка ООО "Экосити"»); POST /messages формат подтверждён (chat.not.found для несуществующего chat_id = корректный запрос); e2e через вебхук: /start → сценарий → 2 ответа бота сохранены в БД; poller подключился к каналу пользователя — lastStatus «OK: получаю сообщения из MAX»; UI проверен в браузере (диалог каналов, подсказка MAX, создание/удаление тестового канала, «Проверить» с фейковым токеном → «Ошибка MAX: неверный или отозванный токен»); сессия и рендер после рестарта в порядке.

Stage Summary:
- Подключение MAX теперь требует ТОЛЬКО токен: студия сама принимает сообщения (long polling) и отправляет ответы. Вебхук и публичный URL не нужны.
- Пользовательский канал «Тест» (бот «Й») уже подключён и слушает MAX.
- Артефакты: src/lib/max-api.ts, src/lib/max-poller.ts, src/instrumentation.ts; обновлены test/webhook роуты и channels-view.

---
Task ID: 6
Agent: main
Task: Дубли сообщений бота в MAX + неработающие кнопки («сообщения дублируются… нет кнопок управления… не выбрать»)

Work Log:
- Диагностика: в БД дублей нет; «дубли» — переспрашивание узла меню при непопадании текста (кнопок в MAX не было, пользователь был вынужден писать текст) + потенциальные повторы при рестарте/ретраях/двойной доставке (webhook+polling) без дедупликации. Подписок вебхуков у бота нет (GET /subscriptions пуст), но защита нужна.
- Кнопки: processInbound терял кнопки (возвращал только replies: string[]). Теперь возвращает messages: {text, buttons}[]; poller/вебхук отправляют их как inline_keyboard (callback-кнопки, payload = текст кнопки — по нему движок матчит выбор).
- Callback: обработка update_type=message_callback — payload/button.text подаётся в processInbound как выбор пользователя; первый ответ доставляется через POST /answers?callback_id (снимает «крутилку»), остальные через POST /messages.
- Дедупликация: (1) in-memory claimInboundKey (src/lib/inbound-dedupe.ts, TTL 10 мин) для mid/callback_id; (2) БД-бэкстоп — поле Message.externalKey + @@unique([conversationId, externalKey]), P2002 → duplicate:true без ответа. Защищает от повторов при рестарте, ретраях long polling и двойной доставке.
- Одиночная доставка: poller при старте цикла отписывает бот от всех вебхук-подписок (GET/DELETE /subscriptions) — MAX доставляет и так, и так, если подписка осталась.
- max-api.ts: maxSendMessage (inline_keyboard), maxAnswerCallback, maxListSubscriptions, maxDeleteSubscription.
- Верификация: lint чисто; e2e — повторное сообщение с тем же mid не создаёт дубля; callback «❓ Частый вопрос» → движок → n_ai → n_more; повтор callback с тем же callback_id задублирован; демо-чат (NULL externalKey) работает по unique-индексу; poller подключён к каналу пользователя.

Stage Summary:
- В MAX теперь приходят кликабельные кнопки сценария; нажатие обрабатывается движком (выбор по тексту кнопки).
- Дубли устранены на трёх уровнях: in-memory, БД (unique), отписка вебхуков.
- Артефакты: src/lib/inbound-dedupe.ts; обновлены webhook.ts, max-api.ts, max-poller.ts, webhook/max route, prisma schema (Message.externalKey).
