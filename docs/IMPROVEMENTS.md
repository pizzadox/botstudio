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
