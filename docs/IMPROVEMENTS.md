# Реестр улучшений BotStudio — волна 20 (2026-10-08)

Источник: глубокий аудит перформанса (бэкенд) и UX (фронтенд). Статусы: ⬜ план / 🔄 в работе / ✅ готово / ⏭ отложено.

## A. Бэкенд и данные (агент 20-BE)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-B01 | Починить корни ~50 tsc-ошибок: `webhook.ts` `let conversation: Conversation \| null`, `orders.ts` `let order: Order \| null`, `normalizeApiUrl(input?: string)` | ✅ |
| IMP-B02 | Индексы Prisma: Message(conversationId,createdAt); Conversation(botId,updatedAt)+(botId,status); Order(botId,createdAt)+(conversationId); Channel(botId); Bot(userId,updatedAt); убрать дублирующий MytkoArea(botId) | ✅ |
| IMP-B03 | db.ts: SQL-лог только в dev + включить WAL для SQLite | ✅ |
| IMP-B04 | GET сообщений (диалог / заявка / демо): параметр `?take=N`, фикс бага «отдаются самые старые» (desc+reverse) | ✅ |
| IMP-B05 | Списковые select: инбокс без `state`, заявки select+take, clientOrders take 20 | ✅ |
| IMP-B06 | Кэш горячего пути: assistantConfig (TTL 60с, инвалидация в ai PUT), JSON.parse(flow) по botId+updatedAt, ZAI-синглтон | ✅ |
| IMP-B07 | Nominatim: очередь 1 rps, in-flight дедуп промисов, LRU вместо полного clear() | ✅ |
| IMP-B08 | Promise.all в последовательных await (bots/[id], conversations/[id], operator, order-messages) | ✅ |
| IMP-B09 | scrypt → async (promisify) в auth.ts | ✅ |
| IMP-B10 | Очистка `__maxOperatorNotes` по TTL/размеру | ✅ |
| IMP-B11 | Периодическая чистка протухших сессий (instrumentation, раз в час) | ✅ |
| IMP-B12 | Кэш списка areaCodes per-bot TTL 5 мин (вместо 11k findMany на каждый sync) | ✅ |
| IMP-B13 | tsc: исключить download/ из tsconfig; убрать ignoreBuildErrors если src чист | ✅ |
| IMP-B14 | MyTKO sync-areas: защита от параллельного запуска (lock-флаг) | ✅ |
| IMP-B15 | bulk upsert КП одним INSERT..ON CONFLICT; префильтр кодов отчётов по городу | ⏭ (риск, отдельная волна) |

## B. Инбокс и чаты (агент 20-FE1)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-F01 | Умный автоскролл: только когда пользователь у дна переписки | ✅ |
| IMP-F02 | Optimistic отправка: пузырь «отправляется», при ошибке текст не теряется + «Повторить» | ✅ |
| IMP-F03 | Поллинг сообщений `take=50` + дедуп-слияние по id вместо полной перезагрузки 200 | ✅ |
| IMP-F04 | ↑/↓ навигация по списку диалогов (клавиатура) | ✅ |
| IMP-F05 | timeAgo с `title` = полная дата/время | ✅ |
| IMP-F06 | useDeferredValue для поиска | ✅ |
| IMP-F07 | Сохранение фильтра/поиска инбокса в localStorage | ✅ |
| IMP-F08 | Пауза поллинга на document.hidden + индикатор «обновлено N с назад» + баннер после 3 сбоев | ✅ |
| IMP-F09 | memo строк диалогов | ✅ |

## C. Заявки и карта (агент 20-FE2)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-F10 | Дифф маркеров карты (add/remove/setLngLat/класс selected) вместо пересоздания; selectedId вне зависимостей | ✅ |
| IMP-F11 | Чат заявки: take=50 + слияние, умный автоскролл, optimistic отправка | ✅ |
| IMP-F12 | memo OrderRow + useMemo filtered() | ✅ |
| IMP-F13 | Кнопки копирования: номер заявки, телефон, координаты, ID клиента | ✅ |
| IMP-F14 | Сохранение вкладки/фильтров/поиска заявок в localStorage | ✅ |
| IMP-F15 | Пауза поллинга на hidden + индикатор свежести | ✅ |
| IMP-F16 | Скелетон загрузки карточки заявки | ✅ |
| IMP-F17 | Нативный checkbox → shadcn Checkbox + aria-label | ✅ |
| IMP-F18 | Не сломать spiderfy (44px, Task 18) — регресс-проверка | ✅ |

## D. Конструктор (агент 20-FE3)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-F19 | Ctrl/Cmd+S — форс-сохранение сценария | ✅ |
| IMP-F20 | Esc закрывает инспектор/тест-чат | ✅ |
| IMP-F21 | beforeunload-guard при несохранённых правках | ✅ |
| IMP-F22 | memo(FlowCard) — канвас 65 узлов не перерисовывается на каждый символ | ✅ |
| IMP-F23 | setSaveState без дублей (guard уже-unsaved) — меньше ре-рендеров при drag | ✅ |
| IMP-F24 | MiniMap nodeColor — вынести константу | ✅ |
| IMP-F25 | Скелетон загрузки канваса вместо Loader2 | ✅ |
| IMP-F26 | rounded-xl консистентность палитры | ✅ (проверено: чипы-кнопки палитры — rounded-lg по конвенции, не трогал) |

## E. Оболочка, дашборд, каналы, ИИ (агент 20-FE4)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-F27 | AlertDialog подтверждения: удаление канала / бота / записи БЗ | ✅ |
| IMP-F28 | error.tsx — error boundary с «Попробовать снова» (без белого экрана) | ✅ |
| IMP-F29 | Тёмная тема: next-themes ThemeProvider + тумблер в shell (dark-классы уже написаны, но были недостижимы!) | ✅ |
| IMP-F30 | Ctrl/Cmd+K палитра команд (переход по разделам + переключение бота, cmdk уже установлен) | ✅ |
| IMP-F31 | Таблица отчётов MyTKO: slice(0,100) + «показать все» | ✅ |
| IMP-F32 | Пауза notifications-поллинга на hidden | ✅ |
| IMP-F33 | Единые h1: text-lg sm:text-2xl font-bold tracking-tight во всех view | ✅ |
| IMP-F34 | Фикс formatDetection в Viewport (layout.tsx) | ✅ |

## G. Память проекта
- docs/UI-CONVENTIONS.md — дизайн-система и правила кода для будущих агентов
- docs/IMPROVEMENTS.md — этот реестр (обновлять статусы)
- worklog.md — журнал работ по задачам

---

# Реестр улучшений BotStudio — волна 21 (2026-10-08)

Источник: второй аудит (2 Explore-агента: 24 FE- + 26 BE-находок). Все пункты выполнены 4 параллельными агентами (21-BE1, 21-BE2, 21-FE1, 21-FE2).

## A. Безопасность API (агент 21-BE1)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-BE21-01 | Маскирование секретов: GET/PUT bots/[id] — mytkoConfig вырезан (→ mytko:{enabled,hasToken}), каналы token → tokenMasked+hasToken+webhookUrl; санитайзеры во всех роутах каналов; PUT «пустой token = не менять» больше не затирает токен | ✅ |
| IMP-BE21-03 | НОВЫЙ POST /api/channels/[id]/test: max (maxGetMe) / telegram (getMe) / whatsapp (graph.me) / web; lastStatus пишется; кнопка «Проверить» наконец работает | ✅ |
| IMP-BE21-04 | Rate-limit login (5/15мин по ip+username) и register (5/15мин по ip) → 429 | ✅ |
| IMP-BE21-07 | register: P2002 → 409 «Логин занят» (был 500) | ✅ |
| IMP-BE21-11 | Cache-Control: no-store на поллинг-GET: notifications, conversations/[id], orders messages, demo | ✅ |
| IMP-BE21-10 | Demo webhook rate-limit: 20/мин per-IP + 10/мин per-conversation → 429 | ✅ |
| IMP-BE21-22 | Индекс Session(expiresAt) для часовой чистки | ✅ |
| IMP-BE21-19 | notifications: botNames через Map вместо find | ✅ |
| IMP-BE21-21 | Пагинация ?take (cap 500) в bots/[id]/conversations и orders | ✅ |
| IMP-BE21-12 | Лимиты длин: name 120 / description 500 / channel title 120 | ✅ |

## B. Надёжность и MyTKO (агент 21-BE2)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-BE21-02 | Таймаут ИИ-вызова 45с (Promise.race, unref, clearTimeout) → существующие fallback-тексты | ✅ |
| IMP-BE21-13 | persistFreshToken в finally — свежий токен MyTKO больше не теряется при неуспехе | ✅ |
| IMP-BE21-08 | MyTKO: отчёты — чанки параллельно (concurrency 3), таймаут 90→35с, префильтр кодов по городу (getAreasCached + resolveAreaCodes, фолбэк полный реестр); sync-areas — bulk INSERT..ON CONFLICT чанками 400 (проверено на копии БД: 850 строк, повторный апдейт, null'ы) | ✅ |
| IMP-BE21-09 | Шифрование пароля MyTKO AES-256-GCM (APP_SECRET в .env.local, enc:v1:, plaintext-совместимость, живой тест цепочки) | ✅ |
| IMP-BE21-05 | Demo-guard: conversationId принимается только от web-каналов (channel.type==='web' или source='web'); чужой ID → «как без ID», инъекции в MAX/Telegram-диалоги невозможны (живой тест) | ✅ |
| IMP-BE21-06 | simulate: валидация state (≤32КБ, history slice(-50), vars ≤4КБ) → 400; messages через createMany | ✅ |
| IMP-BE21-14 | webhook persistBotMessages: createMany одним запросом | ✅ |
| IMP-BE21-24 | close: (message.create + deliver) пары в Promise.all | ✅ |
| IMP-BE21-25 | orders.ts: unref у гео-таймеров | ✅ |
| IMP-BE21-23 | inbound-dedupe: sweep не чаще раза в минуту | ✅ |
| (фикс) | orders/[orderId]/mytko: serializeMytkoConfig вместо JSON.stringify (пароль не возвращается в БД plaintext'ом) | ✅ |

## C. Редактор флоу (агент 21-FE1)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-FE21-01 | Защита от затирания сценария: loadError-state + LoadErrorCard («Повторить»), loadedRef false при сбое, гварды saveNow/handleNodesChange/addNode, палитры скрыты | ✅ |
| IMP-FE21-03 | Undo удаления блока: снапшот nodes/edges (оба пути: кнопка и Delete-клавиша), тост с ToastAction «Отменить» 5с, восстановление + выбор узла | ✅ |
| IMP-FE21-04 | togglePublish: await saveNow() при unsaved/saving, сбой → публикация прервана | ✅ |
| IMP-FE21-13 | Инспектор: clamp(0,3)+inputMode для паузы; мягкая live-валидация JSON http-блока | ✅ |
| IMP-FE21-20 | maxLength 4000 + счётчики на textarea инспектора (amber >90%) | ✅ |
| IMP-FE21-07 | Тест-чат: поллинг пауза на document.hidden (паттерн волны 20) | ✅ |
| IMP-FE21-08 | Тест-чат: runIdRef-поколения — старые ответы не догоняют новую генерацию | ✅ |
| IMP-FE21-16 | Пузыри бота тест-чата → конвенция (border bg-card rounded-br-md) | ✅ |
| IMP-FE21-21 | Палитра: min-h-11 (44px тач) на чипах | ✅ |

## D. Оболочка, каналы, формы (агент 21-FE2)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-FE21-02 | Мобильное «Ещё»-меню (MoreVertical): тема (RadioGroup light/dark), «Палитра команд» (prop onOpenPalette), «Выйти»; logout убран из мобильного хедера | ✅ |
| IMP-FE21-06 | Persist view+botId в localStorage (bstudio.view/bstudio.botId), восстановление одним GET /api/bots, очистка при logout | ✅ |
| IMP-FE21-05 | Палитра: перезапрос ботов при каждом открытии | ✅ |
| IMP-FE21-24 | Notifications: 3 сбоя подряд → разовый тост «Нет связи», сброс при успехе | ✅ |
| IMP-FE21-10 | form+Enter+autofocus: создание/переименование бота, канал, запись БЗ; busy-кнопки | ✅ |
| IMP-FE21-11 | Login: autofocus, клиентская валидация пароля (minLength/pattern), сброс ошибки при смене вкладки, eye-toggle с aria-pressed | ✅ |
| IMP-FE21-09 | «Проверить» канала: testBusyId → Loader2+disabled на проверяемой карточке | ✅ |
| IMP-FE21-14 | Webhook URL с сервера (ch.webhookUrl) + tokenMasked вместо token | ✅ |
| IMP-FE21-12 | MytkoCard: inline-Alert при сбое загрузки с «Повторить», hasPassword только после успешного save, скелетон вместо null | ✅ |
| IMP-FE21-23 | DemoChat через api() + системное сообщение при сбое, aria-label input | ✅ |
| IMP-FE21-17 | Таблица отчётов MyTKO в overflow-x-auto | ✅ |
| IMP-FE21-15 | Empty-states унифицированы h-12 w-12 rounded-xl | ✅ |
| IMP-FE21-18 | Eye-toggle: tabIndex убран, focus-visible ring | ✅ |
| IMP-FE21-19 | Dashboard: role="button" убран, явная кнопка на имени бота | ✅ |
| IMP-FE21-20 | Счётчики prompt (4000) и БЗ (20000) в ai-assistant | ✅ |
| IMP-FE21-22 | createBot: один запрос (POST отдаёт {id,name}), сразу onOpenBot | ✅ |

## Итог волны 21
- 45 улучшений выполнено (BE1: 10, BE2: 11, FE1: 9, FE2: 16 — с учётом фикса сериализации).
- Критичные: защита от затирания сценария (data loss), рабочий «Проверить» канал, маскирование всех секретов в API, шифрование пароля MyTKO, защита демо-виджета от инъекций в чужие диалоги.
- tsc: 0; lint: 0; browser-верификация: см. worklog Task 21.

---

# Реестр улучшений BotStudio — волна 22 (2026-10-08)

Источник: третий аудит (2 Explore-агента: 25 FE- + 20 BE-находок). Реализовано 4 агентами (22-BE1, 22-BE2, 22-FE1, 22-FE2) + интегратор (метрики).

## A. Движок и мессенджеры (агент 22-BE1)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-BE22-01 | Crash-safety: try/catch вокруг runEngine (fallback клиенту, состояние сохраняется), нормализация битого flow в кэше, per-update try/catch в MAX-poller (батч не теряется) | ✅ |
| IMP-BE22-02 | src/lib/flow-validate.ts normalizeFlow: whitelist типов, text ≤4000, buttons ≤20, ≤500 узлов, ≤1МБ; подключён в PUT bots/[id] (400 на мусор) | ✅ |
| IMP-BE22-03 | Чанкование сообщений: MAX ≤3900 (кнопки в последний чанк), Telegram ≤4000, sendReplies без обрыва | ✅ |
| IMP-BE22-04 | Telegram: callback_query → текст кнопки движку, дедуп update_id, inline_keyboard, callback_data ≤64 байт (длинные — текстовой подсказкой) | ✅ |
| IMP-BE22-05 | Экспоненциальный backoff long-polling (5с·2^n, cap 2мин; 401 — 5мин) | ✅ |
| IMP-BE22-10 | Ретрай доставки ×1 (сеть/5xx) | ✅ |
| IMP-BE22-13 | PII-логи убраны (длина + chatId) | ✅ |
| IMP-BE22-14 | Бюджет runEngine 25с → вежливый fallback; warn при MAX_STEPS | ✅ |
| IMP-BE22-15/16 | getMe-ретрай раз в 30 циклов; claim ПОСЛЕ обработки (unique externalKey страхует) | ✅ |
| IMP-BE22-19 | Нормализация полей заявки из сценария (slice/phone) | ✅ |
| IMP-BE22-11 | http-узел: encodeURIComponent, JSON-escape, запрет приватных хостов (SSRF) | ✅ |

## B. API-возможности (агент 22-BE2)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-BE22-06 | POST /api/auth/password: смена пароля (verify, ≥6, другие сессии инвалидируются, rate-limit) | ✅ |
| IMP-BE22-07 | GET /api/bots/[id]/orders/export: CSV с BOM, фильтры status/from/to | ✅ |
| IMP-BE22-08 | GET /api/health {ok, uptime, db, metrics} + src/lib/metrics.ts (6 счётчиков на globalThis) | ✅ |
| IMP-BE22-09 | Матрица переходов статусов (финальные без force → 400), completedAt не затирается; POST orders/bulk | ✅ |
| IMP-BE22-12 | Conversation.pinnedAt + POST .../pin; закреплённые сверху; джоба чистки пустых web-диалогов 7д (instrumentation) | ✅ |
| IMP-BE22-17 | Demo GET rate-limit 60/мин | ✅ |
| IMP-BE22-20 | clientIp: XFF только при TRUST_PROXY=1 | ✅ |
| IMP-BE22-21 | bots GET: ordersCount + channelStatuses (типы готовы) | ✅ |
| (метрики) | Интегратор: inc() подключены в webhook (inbound/inboundErrors), flow-engine (aiTimeouts), deliver (deliveries/deliveryFailures), auth (rateLimited) | ✅ |

## C. Заявки и инбокс (агент 22-FE1)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-FE22-01 | Быстрые чипы статуса «Взять в работу»/«Выполнить» (+disabled при saving) | ✅ |
| IMP-FE22-02 | Мини-таймлайн статусов (Создана→Обновлена→Выполнена) | ✅ |
| IMP-FE22-03 | Фильтры дат «Сегодня/7 дней/Всё» (persist) | ✅ |
| IMP-FE22-04 | «Скопировать заявку» целиком | ✅ |
| IMP-FE22-05 | «Открыть диалог» из карточки (CustomEvent → инбокс) | ✅ |
| IMP-FE22-06 | Скелетон чата заявки вместо ложного пустого состояния | ✅ |
| IMP-FE22-07 | AlertDialog удаления заявки | ✅ |
| IMP-FE22-08/09 | memo lng; h1 конвенция | ✅ |
| IMP-FE22-10 | Поля disabled при saving; открытие созданной заявки; «Экспорт CSV» | ✅ |
| IMP-FE22-24 | Черновики per-диалог (persist) + Textarea Enter/Shift+Enter | ✅ |
| IMP-FE22-25 | Меню «…» строки: закрепить, копировать контакт/переписку, закрыть обращение (любой открытый) | ✅ |

## D. Виджет, профиль, глобал (агент 22-FE2)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-FE22-17 | Публичный виджет /w/[secret] (standalone HTML, launcher, safe-area, мобайл dvh) + «Код для сайта» (iframe-сниппет) | ✅ |
| IMP-FE22-14/15/16/18 | «Бот печатает…», 429 → cooldown 60с, скелетон+приветствие, статус шапки по 409, тач-чипы, aria-live, поллинг-пауза | ✅ |
| IMP-FE22-23 | Профиль: кнопка имени + «Ещё»-меню, Dialog смены пароля (API BE2) | ✅ |
| IMP-FE22-19 | Skip-link + focus-visible-сетка в globals.css | ✅ |
| IMP-FE22-20 | overflow-wrap:anywhere в пузырях + prefers-reduced-motion | ✅ |
| IMP-FE22-21 | Обзор-панель дашборда: кликабельные «Новых заявок»/«Требуют внимания», бейдж каналов, ordersCount | ✅ |
| IMP-FE22-11/12/13 | flow-node: индикация «Не настроен», подписи да/нет, «+N» кнопок, без дублей заголовка | ✅ |

## Итог волны 22
- 47 улучшений (BE1: 12, BE2: 10+метрики, FE1: 12, FE2: 11).
- tsc 0; lint 0; /api/health, /w/[secret], demo-вебхук, движок — проверены живьём; browser-верификация — worklog Task 22.

# Волна 23 — жалобы, реестр КП, кластеры карты, гео-фикс, скиллы+chat.md

Запросы пользователя: скиллы из awesome-openclaw-skills + постоянный chat.md; вкладка для жалоб; фикс «после открытия точки все точки увеличиваются»; кластеризация близких точек с раскрытием по клику; исправить неверную точку геолокации; справочник реестра КП; как использовать /w/[secret]. Плюс обязательный параллельный Reviewer-агент.

## A. Жалобы/обращения (агент 23-BE + 23-FE-TABS)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-23-BE-01 | Модель Complaint (type/status/description/happenedAt/contact/source, unique(botId,number), индексы) | ✅ |
| IMP-23-BE-02 | API: GET/POST /api/bots/[id]/complaints (курсор, фильтры, counts) + PATCH/DELETE [complaintId] | ✅ |
| IMP-23-BE-03 | notifications: + complaints (новые обращения) → бейдж вкладки | ✅ |
| IMP-23-BE-04 | Движок: data.createComplaint (typeVar по ключевым словам, {{complaint.number}}, ошибки не роняют сценарий) + flow-validate | ✅ |
| IMP-23-BE-05 | Сценарий «Экосити»: n_cmp_menu saveSelection cmp_type + n_cmp_done createComplaint → жалобы регистрируются автоматически | ✅ |
| IMP-23-TAB-01..02 | ViewKey 'complaints'|'areas', лейблы/бейджи, NAV + «Ещё»-меню (секция «Разделы»), палитра, persist | ✅ |
| IMP-23-TAB-03 | Вкладка «Обращения»: чипы статусов со счётчиками, тип-фильтр, карточки (line-clamp, source/тип/статус), ручное добавление, оптимистичный PATCH, «Открыть диалог», poll 8с, скелетоны/ошибка/пусто | ✅ |

## B. Карта (агент 23-FE-MAP)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-23-MAP-01 | Фикс zoom-храповика: клик по списку — панорама без зума; «Показать на карте» — подъём только с <12 до 13; сброс stale focus | ✅ |
| IMP-23-MAP-02 | Кластеризация supercluster: пилюли с числом (a11y), клик → expansion-zoom до раздельных точек, дифф по cluster_id | ✅ |
| IMP-23-MAP-03 | Первый fitBounds по видимым точкам (один раз, maxZoom 13, сброс при смене бота) | ✅ |
| IMP-23-MAP-04 | Spiderfy на 'moveend' (без дрожания), легенда «N — кластер» | ✅ |

## C. Гео и реестр КП (агент 23-BE + 23-FE-TABS)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-23-BE-06 | Гео: geocodeOrderAddress (город+адрес, без дублей), force-обход кэша для перепроверки, viewbox Новгородской обл. (1-й проход) | ✅ |
| IMP-23-BE-07 | reverseGeocode: чистка префиксов «(городской|муниципальный) округ» из любого источника | ✅ |
| IMP-23-BE-08 | Заявка №7: адрес очищен, точка подтверждена Nominatim (дом на Студенческой — верная) | ✅ |
| IMP-23-BE-10 | GET /api/bots/[id]/mytko/areas: пагинация, поиск q, город-фильтр, total/pages/areasSyncedAt (10 952 КП) | ✅ |
| IMP-23-TAB-04 | Вкладка «Реестр КП»: статистика, поиск (debounce), город, пагинация, OSM-ссылки, CTA синка с busy-прогрессом | ✅ |
| IMP-23-TAB-05/06 | «Код для сайта»: 4 шага инструкции; docs/WIDGET.md (secret, лимиты, FAQ) | ✅ |

## D. Скиллы и процесс (интегратор)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-23-INT-01 | chat.md — постоянный протокол: читать перед КАЖДЫМ запросом (скиллы→когда применять, конвейер ОРКЕСТРАТОРА, чек-лист) | ✅ |
| IMP-23-INT-02 | Установлены скиллы: code-review, agent-team-orchestration, superpowers-systematic-debugging, react-best-practices (+86 в библиотеке) | ✅ |
| IMP-23-REV-1..6 | Фиксы ревьюера: P2002-ретрай POST, no-op геокода без адреса, fallback complaint.number, maxLength 2000, lucide-иконки, прогресс пагинации реестра | ✅ |
| IMP-23-INT-03 | Чистка тест-артефактов агентов (v23map, заявки-№9, «Тест 22-FE2»), восстановление пароля pizzadox | ✅ |

## Итог волны 23
- 28 улучшений (BE: 10, FE-MAP: 5, FE-TABS: 7, интегратор+reviewer: 6).
- tsc 0; lint 0; dev.log чист; browser-верификация: обе вкладки, CRUD жалоб, поиск/пагинация реестра, кластеры карты, фикс зума, /w/[secret] 200, мобайл 390px, тёмная тема.

---

# Реестр улучшений BotStudio — волна 24 (2026-10-08)

Тема: **КП ↔ карта ↔ заявки/жалобы, экипажи, клиент, дата вместо «завтра»**. Оркестрация по chat.md: аудит (2 Explore) → инфраструктура интегратора → 3 исполнителя параллельно (24-BE, 24-FE1, 24-FE2) → Reviewer параллельно (24-REV) → фиксы → верификация.

## A. Бэкенд (агент 24-BE)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-24-BE-01 | wish-date.ts: парсер «сегодня/завтра/послезавтра/через N дней/дни недели/dd.mm/дд месяц» → дата (TZ Europe/Moscow) + human-строка с днём недели и сохранением «до 12:00» | ✅ |
| IMP-24-BE-02 | Движок: разбор даты ДО интерполяции ответа — {{date}} клиенту показывает «09.10.2026, пятница, до 12:00», wishDate + pickupAt пишутся в заявку | ✅ |
| IMP-24-BE-03 | Движок: clientName fallback = контакт диалога (сценарий без имени больше не теряет клиента) | ✅ |
| IMP-24-BE-04 | Движок: жалоба получает гео — addressVar → последняя заявка диалога → геокодинг; ошибки Nominatim не блокируют создание | ✅ |
| IMP-24-BE-05 | flow-types: createComplaint.addressVar/cityVar | ✅ |
| IMP-24-BE-06 | area-match.ts: haversineM + matchAreasFor (координаты ≤250 м + пересечение адресных токенов, score, byCoord/byAddress) | ✅ |
| IMP-24-BE-07..16 | crews API (GET/POST/PATCH/DELETE, владелец-скоуп, ordersCount); areas ?bbox= (карта КП, cap 1000) и ?near=&radius= (расстояния); PATCH заявки: crewId/areaLkCode (валидация принадлежности, снапшот areaAddress, pickupAt из wishDate); GET заявки/списка: crew/areaLkCode/areaAddress/pickupAt; area-match роуты для заявки и жалобы; PATCH жалобы: address (+геокод)/areaLkCode; POST жалобы: address | ✅ |

## B. Фронт «Заявки» (агент 24-FE1)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-24-FE1-01 | Карточка клиента редактируемая: имя/телефон (onBlur → PATCH, null-очистка) | ✅ |
| IMP-24-FE1-02 | Экипаж: Select в карточке + CrewsManagerDialog (создание, инлайн-редактирование, Switch активности, удаление с подтверждением, ordersCount); бейджи экипажа и КП в списке заявок | ✅ |
| IMP-24-FE1-03 | Чип «Забор: пт, 09.10.2026» из pickupAt (дата вместо слов) | ✅ |
| IMP-24-FE1-04 | Саджест «Совместить с КП»: до 3 кандидатов с дистанцией/основанием, «Совместить»/«Не сейчас», привязанный бейдж + «Отвязать» | ✅ |
| IMP-24-FE1-05 | Слой КП на карте: тумблер «Показать КП» (по умолч. выкл), bbox-подгрузка с debounce 600мс, свои DOM-маркеры-ромбы (diff по lkCode, не мешают кластерам волны 23), счётчик, легенда, KpDialog (адрес, координаты, OSM, «Совместить с заявкой №N») | ✅ |

## C. Фронт «Обращения» (агент 24-FE2)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-24-FE2-01 | Мета-строка: адрес (MapPin) + координаты + бейдж «КП {код}» | ✅ |
| IMP-24-FE2-02 | Секция «Совместить с КП»: candidates с дистанцией/основанием, привязка/отвязка, «КП рядом…» с ретраем и aria-live | ✅ |
| IMP-24-FE2-03 | Inline-редактор адреса (Enter, сохранение → геокодинг на бэке) | ✅ |
| IMP-24-FE2-04 | Общий patchComplaint с оптимистикой и откатом; POST вручную — поле адреса | ✅ |

## D. Сценарий «Экосити» и ревью (интегратор)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-24-INT-01 | Сценарий: вопрос «Как вас зовут?» в ветках waste/kgm (nameVar), вопрос адреса площадки в ветке жалоб (addressVar) — 71→74 узла | ✅ |
| IMP-24-REV-1 | PATCH заявки возвращает conversation/crew/messagesCount (как GET) — карточка не теряет блоки после сохранения | ✅ |
| IMP-24-REV-2 | Null-семантика очистки clientName/phone/city (заявки) и phone/notes (экипажи) | ✅ |
| IMP-24-REV-3/6 | Cap radius 2000 в area-match; writeback даты только при ровно одном плейсхолдере шаблона | ✅ |
| IMP-24-REV-5/7 | Abort KP-слоя при unmount/смене бота; AbortController в «КП рядом…» жалоб | ✅ |
| ⏭ Бэклог 25 | REV-4 (кэш токенов area-match), REV-8 (ручные координаты жалобы) | ⏭ |

## Итог волны 24
- 24 улучшения (BE: 16, FE1: 5, FE2: 4, сценарий+ревью-фиксы: сверх).
- tsc 0; lint 0; dev.log 0 ошибок; browser-верификация (pizzadox-сессия): слой КП 10 757 точек + KpDialog, привязка заявки №7 к КП 53901362, чип «Забор: пт, 09.10.2026», экипаж создан и назначен, жалоба с адресом совмещена с КП, мобайл 390px + тёмная тема.

---

# Волна 25 (2026-10-09): дожим качества волны 24 + инбокс-жалобы + виджет-кнопки + производительность КП

Контекст: после восстановления БД из снапшота (платформенный сброс) — аудит 3×Explore-агентами; закрыты долги REV-4/REV-8 из волны 24 и найдены новые major-баги. 4 параллельных агента (BE1/BE2/FE1/FE2) + параллельный Reviewer. tsc 0; lint 0.

## A. Бэкенд «заявки/экипажи/даты» (агент 25-BE1)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-25-01 | sync-роут MyTKO возвращает полный DTO (crew/conversation/messagesCount) — карточка не «худеет» после синка | ✅ |
| IMP-25-02 | wish-date: явный год после месяца («3 октября 2026» = 03.10.2026, а не 2027!); + «через N дней/неделю/2 недели/месяц/сутки»; «29 февраля 2028» | ✅ |
| IMP-25-03 | CSV-экспорт: +5 колонок (дата забора, экипаж+тел, КП код/адрес); гвард CSV-инъекций (= + - @ Tab); все даты в Europe/Moscow | ✅ |
| IMP-25-04 | GET /orders → total (для честного баннера «показаны N из M») | ✅ |
| IMP-25-05 | bulk-роут принял crewId (null = снять) с валидацией принадлежности | ✅ |
| IMP-25-06 | PATCH заявки принял pickupAt (ISO / YYYY-MM-DD → полдень MSK); валидация 2027-02-29 → 400 | ✅ |
| IMP-25-07 | normalizePhone экспортирована и в PATCH заявки, и в POST/PATCH экипажей; city-лимит 120 везде | ✅ |
| IMP-25-08 | GET /crews → activeOrders (не финальные статусы) рядом с ordersCount | ✅ |

## B. Бэкенд «жалобы/движок/webhook/КП» (агент 25-BE2)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-25-09 (REV-8) | PATCH жалобы: geocode:true (перегеокод), ручные lat/lng (±90/±180), автоперегеокод при смене адреса с существующей точкой | ✅ |
| IMP-25-10 (REV-4) | Кэш токенизации КП (WeakMap-индекс lower+tokens) — area-match больше не токенизирует 11k адресов на каждый запрос | ✅ |
| IMP-25-11 | Виджет видит кнопки: persist пишет РЕАЛЬНЫЙ nodeId узла ('__bot' — только для сервисных сообщений); demo GET находит узел и отдаёт buttons | ✅ |
| IMP-25-12 | Close-race: finish() не переоткрывает диалог, закрытый во время работы движка | ✅ |
| IMP-25-13 | Движок: contact из nameVar (вместо «Гость сайта»), error-флаги order_error/complaint_error для условий сценария, parseComplaintWhen через parseWishDate (русские даты в happenedAt) | ✅ |
| IMP-25-14 | Эскалация: PATCH жалобы {orderId} с валидацией «заявка этого бота» | ✅ |
| IMP-25-15 | notifications → newComplaints (топ-5, форма как newOrders) | ✅ |
| IMP-25-16 | GET /complaints?conversationId= (панель «жалобы клиента» инбокса) | ✅ |
| IMP-25-17 | areas bbox: cap 2500 + ?sort=dist (дистанция до центра рамки); count из кэша | ✅ |

## C. Фронт «Заявки» (агент 25-FE1)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-25-18 | КП-слой: supercluster-кластеры КП (ромбы с числом, клик → expansion-zoom), DOM только для одиночных; zoom-gate 11: ниже — «Приблизьте карту», чип «КП: N» честный (+sort=dist → «ближайшие к центру кадра») | ✅ |
| IMP-25-19 | KpDialog: «Перелететь к КП», «Совмещена с этой заявкой» + «Отвязать», confirm при перезаписи; подсветка привязанной КП зелёным кольцом; чип ошибки загрузки с «Повторить»; kpEnabled persist | ✅ |
| IMP-25-20 | Массовые операции: чекбоксы строк, bulk-бар (статус/экипаж/применить), AlertDialog на финальные статусы, тост с итогом | ✅ |
| IMP-25-21 | Фильтр «Экипаж» + поиск по имени экипажа/КП; total-баннер при total > 500 | ✅ |
| IMP-25-22 | date-input «Когда забрать» (пишет pickupAt), превью «Дата не распознана» под wishDate; тосты с причиной ошибки; formatDateRu в MSK | ✅ |

## D. Фронт «Жалобы/инбокс/инспектор» (агент 25-FE2)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-25-23 | Merge-пагинация жалоб: поллинг больше не схлопывает догруженные страницы (+ hard-load каждый 10-й тик — чистка фильтров) | ✅ |
| IMP-25-24 | Тихие фейлы patchComplaint → тосты с причиной | ✅ |
| IMP-25-25 | «Перегеокодировать» (PATCH geocode:true) + координаты с копированием + хинт «точка пересчитана» | ✅ |
| IMP-25-26 | «Создать заявку из жалобы»: POST с префиллом → PATCH orderId → чип «Заявка №N» (+ событие bstudio:open-orders) | ✅ |
| IMP-25-27 | Инбокс: «Создать жалобу» в меню строки; панель «Жалобы клиента»; controlled «Исполнитель» | ✅ |
| IMP-25-28 | Инспектор: редактор createComplaint (тип/typeVar/descriptionVar/whenVar/addressVar/cityVar) + nameVar/cityVar у createOrder; flow-validate валидирует новые поля | ✅ |
| IMP-25-29 | Тост «Новая жалоба №N» из notifications (кликабельный → вкладка жалоб) | ✅ |

## E. Инфра и ревью (интегратор + 25-REV)
| ID | Улучшение | Статус |
|----|-----------|--------|
| IMP-25-INT-01 | dev.sh health-check: ожидание ЛЮБОГО HTTP-ответа (первый 500 холодной компиляции больше не убивает сервер) | ✅ |
| IMP-25-INT-02 | Схема: Complaint.orderId (эскалация); ComplaintDto.orderId, CrewDto.activeOrders; Экосити доведён до 74/128 в живой БД | ✅ |
| IMP-25-REV-1 | Тост bulk читает crewUpdated («Экипаж назначен заявок: N» для crew-only пачки) | ✅ |
| IMP-25-REV-2 | Hard-load жалоб каждый 10-й тик поллинга | ✅ |
| IMP-25-REV-3 | «29 февраля»/«29.02» без года → ближайший високосный (fallback year+1) | ✅ |
| IMP-25-REV-4 | Меню после «Закрыть обращение» — с реальным nodeId (чипы в виджете) + фильтр '__bot' в lastMenuButtons | ✅ |
| IMP-25-REV-5а | Атомарный гвард переоткрытия (updateMany where status='open'; закрытые до сообщения штатно переоткрываются) | ✅ |
| IMP-25-REV-6 | normalizePhone('+')/('+abc') → null | ✅ |
| IMP-25-REV-7 | Сброс bulk-выделения при смене поиска/фильтров | ✅ |
| IMP-25-REV-8 | CSV-экспорт уважает type/crew-фильтры (?type=, ?crew=none, ?crewId=) | ✅ |
| ⏭ Бэклог 26 | REV-5б (аддитивный closed-флаг, не доставлять реплики после закрытия), ручные lat/lng заявок с валидацией диапазонов, экспорт с курсором, «Показать на карте» из реестра КП, виртуализация реестра, автоназначение экипажа по городу | ⏭ |

## Итог волны 25
- 33 IMP (BE: 17, FE: 12, инфра+ревью: 8 — без дублей) + восстановление БД из снапшота и доведение сценария Экосити до 74/128.
- Reviewer: 0 critical / 0 major / 8 minor — все 8 закрыты в этой же волне.
- Браузерная верификация: КП-слой (zoom-gate → кластеры «КП: 13» → KpDialog «Перелететь»), bulk «Экипаж назначен заявок: 2», фильтр экипажа, date-input → pickupAt 09:00Z в БД, превью «Дата не распознана», перегеокод жалобы («Точка обновлена: 58.53674, 31.29573»), эскалация «Заявка №9 создана из жалобы» (+ orderId в БД), «Жалоба №2 создана» из инбокса, панель «Жалобы клиента», виджет: buttons снова приходят, инспектор createComplaint со всеми полями, мобайл 390px dark — noHScroll:true.
