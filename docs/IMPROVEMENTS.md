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
