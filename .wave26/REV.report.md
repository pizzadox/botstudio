# 26-REV — код-ревью волны 26 (BE / FE1 / FE2)

Reviewer-агент · только отчёт, код не правился · dev-сервер/git не тронуты.

## Сводка

**0 critical / 0 major / 5 minor** — волна 26 готова к интеграции и верификации.
Все 10 IMP реализованы по ТЗ; контрактные и семантические проверки пройдены,
находки — только честность-сигналы и косметика, блокирующих нет.

---

## Находки (minor)

### MINOR-1 · auto-assign: X-Truncated ложноположительный при ровно 2000 кандидатов
- **Где:** `src/app/api/bots/[id]/crews/auto-assign/route.ts:74`
- **Суть:** `capped = orders.length >= ORDERS_CAP` — если у бота РОВНО 2000 заявок-кандидатов,
  все они полностью обработаны (ничего не срезано), но заголовок `X-Truncated: 1` всё равно
  уйдёт. В export-роуте этот же кейс решён peek-запросом (`export/route.ts:206-218`), здесь
  сигнал менее честный, чем соседний.
- **Фикс (минимальный):** peek-запрос `order.findFirst({ where: <тот же where>, select: { id: true }, skip: ORDERS_CAP })` — заголовок ставить только если строка найдена. Либо смириться и
  задокументировать «>= капа» как семантику сигнала (не блокирует).

### MINOR-2 · план автоназначения показывает нормализованный (нижний регистр) город
- **Где:** `crews/auto-assign/route.ts:103,118` (label = normalizeCityName-ключ) + рендер
  `orders-view.tsx:3137-3138,3155-3156`
- **Суть:** `CrewAutoAssignPlanItem.city` заполняется ключом `normalizeCityName` → в AlertDialog
  колонка «Город» и amber-блок unmatched показывают «великий новгород», «боровичи» — а не
  исходное «Великий Новгород». Комментарий studio-types «как в Crew.city» вводит в заблуждение
  (Crew.city — сырой, в DTO — нормализованный). Косметика + мелкое недоумение оператора.
- **Фикс (минимальный):** в route при сборке plan-item/unmatched брать display-город из сырого
  `o.city` первого элемента группы (ключ остаётся внутренним), поправить комментарий типа.
  Либо принять как есть (ключ согласован и truncate+title уже есть).

### MINOR-3 · areas-view: футер «Показано N из total» противоречит кап-нотису при overCap
- **Где:** `src/components/studio/areas-view.tsx:549` (футер) vs `:469-473` (role=note)
- **Суть:** при `areas.length > RENDER_CAP(500)` футер пишет «Показано 620 из 3000», а нотис
  над списком — «Показаны первые 500 из 3000». Оба честны каждый про своё (загружено vs
  отрисовано), но рядом выглядят противоречиво. Поведение «Показать ещё» за капом — по ТЗ
  допустимо (грузит дальше, рендер ограничен, нотис честный) — ок.
- **Фикс (минимальный):** при overCap в футере показывать `Показано {Math.min(areas.length, RENDER_CAP)}+ из {total}` или скрывать футер, оставляя только нотис.

### MINOR-4 · возврат на вкладку карты повторно перелетает к последней сфокусированной КП
- **Где:** `src/components/studio/orders-view.tsx:678-688` (OrdersMap-эффект) + условный маунт
  OrdersMap `:4390` (`tab === 'map'`)
- **Суть:** тик «сгорает» в `kpFocusTickRef` внутри OrdersMap, но OrdersMap размонтируется при
  уходе с вкладки карты — ref сбрасывается в 0, а `kpFocusTick`/`kpFocusTarget` в OrdersView
  живут. Возврат на «Карта» → tick ≠ ref → повторный `easeTo` к той же КП. Не баг данных,
  UX-причуда (камера «возвращается» к давнему фокусу); race «easeTo до ready» при этом закрыт
  корректно (ref горит только после ready — проверено).
- **Фикс (минимальный):** при смене tab в OrdersView сбрасывать `setKpFocusTick(0); setKpFocusTarget(null)` (тогда ref 0 == tick 0 → перелёта нет), либо после easeTo звать колбэк done по образцу `onFocusDone`/`clearMapFocus`.

### MINOR-5 (информационная) · residual TOCTOU-окно в persistBotMessages
- **Где:** `src/lib/webhook.ts:400-418`
- **Суть:** зеркало-проверка (findUnique status) и createMany — два отдельных запроса: закрытие,
  попавшее точно в окно между ними (~один DB-раундтрип), всё же пропустит реплики в БД.
  Полное устранение требует транзакции/условной записи — за рамками ТЗ (оно требовало именно
  «проверка ДО createMany», что выполнено). Практический риск пренебрежим.
- **Фикс (опционально, будущая волна):** интерактивная транзакция «перечитать статус + createMany»
  на SQLite/Prisma.

---

## Что проверено и в порядке

### 1. Безопасность
- auto-assign: auth-паттерн crews (session + `bot.userId === user.id`, 401/404) ✓; все WHERE с
  `botId` (orders, crews, updateMany) ✓; только Prisma, сырого SQL нет ✓.
- export: `rateLimit('csv:'+user.id, 5, 60_000)` стоит сразу после auth, до ownership-проверки;
  ключ по user.id — подменой заголовков не обходится (rate-limit.ts: клиент IP не участвует) ✓; 429 JSON.
- close/orders/crews/auto-assign — повсюду 401 до чтения данных, 404 при чужом боте ✓.

### 2. REV-5б семантика (IMP-26-01)
- close-роут: `closedAt: new Date()` рядом со status:'closed'/needsOperator:false; собственные
  сообщения роута («Обращение закрыто»/меню) идут напрямую через db.message.create +
  deliverTextToConversation — не тронуты, доставляются как раньше ✓.
- persistBotMessages: зеркало-проверка стоит ДО createMany (webhook.ts:393-410 → createMany :410);
  открытый снапшот + fresh='closed' → `messages.length = 0; return` → replies пуст, и MAX
  (`sendReplies(result.messages)` при пустом — ничего не шлёт), и demo/виджет (перечитывают БД)
  ничего не доставят ✓.
- Снапшот, закрытый ДО сообщения, не перечитывается — штатное переоткрытие (семантика
  «продолжение общения») сохранена ✓. Дубликат-ветка P2002 (conversationId+externalKey) не тронута ✓.
- finish(): where-тернарник сохранён (`{id}` для закрытого снапшота / `{id, status:'open'}` для
  открытого), `closedAt: null` добавлен в data (в открытой ветке — no-op, where не менялся) ✓;
  ранние return'ы возвращают `needsOperator: false` (:445, :481) ✓; порядок persist→finish во ВСЕХ
  15 сайтах вызовов соблюдён (проверены все) ✓.
- operator/messages-роуты не в диффе ✓.

### 3. lat/lng заявок (IMP-26-02)
- POST `orders/route.ts:98-114` и PATCH `orders/[orderId]/route.ts:200-216` — валидация
  **бит-в-бит** совпадает с эталоном жалоб (`complaints/[complaintId]/route.ts:169-182`), включая
  текст 400 `«lat/lng — числа (lat −90…90, lng −180…180) или null»` ✓.
- undefined/null валидны в обоих; POST null → точка null (легитимный кейс не заблокирован,
  геокод-fallback по адресу — прежнее поведение) ✓; PATCH null-ветка `:226-230` (снять обе
  координаты + geoSource) сохранена ✓; geocode:true/manualPoint/reverseGeocode/composeAddress не задеты ✓.

### 4. Экспорт (IMP-26-03)
- Курсорная пагинация корректна: `orderBy [{createdAt:'desc'},{id:'desc'}]` (tiebreaker),
  `cursor {id} + skip:1`, последний батч по `batch.length < BATCH_SIZE`, `lastAddedId` от реально
  добавленной строки ✓; кап 5000 с peek-запросом take:1 за последней строкой → `X-Truncated: 1`
  только при реальном усечении (ровно 5000 — не усечение) ✓.
- rate-limit после auth ✓; CSV-выход для <500 строк байт-в-байт эквивалентен (HEADERS/csvCell/
  csvDate/BOM/\r\n/Content-Disposition/no-store не менялись; select+id в CSV не попадает; при
  равных createdAt порядок стал детерминированным — улучшение, не расхождение) ✓.

### 5. auto-assign (IMP-26-05)
- dryRun default TRUE (`body.dryRun !== false`), onlyUnassigned default true ✓; запись только при
  явном `dryRun:false` ✓.
- onlyUnassigned не перетирает назначенных: и в выборке (`crewId: null`), и в apply-updateMany
  (`...(onlyUnassigned ? { crewId: null } : {})`) ✓; FINAL_ORDER_STATUSES исключены и в выборке,
  и в apply ✓ (при onlyUnassigned:false финальные всё равно не трогаются).
- Матч ТОЧНЫЙ по `normalizeCityName` = trim → lowercase → ё→е → stripCityPrefix; вынесенный в
  orders.ts:301-303 stripCityPrefix использует **ту же** регулярку `/^(городской|муниципальный) округ\s*/i`
  + trim, что прежняя inline-замена в reverseGeocode — поведение reverseGeocode идентично
  (подтверждено диффом: старая строка удалена 1-в-1) ✓; дедуп экипажей по городу (первый по
  name asc), unmatched честные (включая вырожденный «городской округ» → сырой лейбл) ✓.
- Применение: `$transaction` + updateMany per crew, `assigned` = сумма РЕАЛЬНЫХ count ✓;
  план на apply пересчитывается сервером — тост показывает фактическое число (честно) ✓.

### 6. React (IMP-26-06/09/10)
- Cleanup: app-root kp-focus listener с removeEventListener ✓; areas-view areaAbortRef — abort
  перед каждым fetch, `finally` только при `areaAbortRef.current === ac`, AbortError тихий,
  cleanup unmount/смены зависимостей (setState после unmount исключён) ✓; debounce-timeout
  чистится ✓.
- Race «easeTo до ready»: `kpFocusTickRef` горит только после `ready`-гварда; при ready=false
  тик переживает и обрабатывается при переключении (ready в deps) ✓.
- Повторный фокус той же КП: app-root копирует AreaItem спредом (новый Object.is) + tick+1 —
  срабатывает снова ✓; `kpFocusTarget`-копия корректно решает race зануления пропа (копия
  ставится в том же коммите, что тик и onKpFocusConsumed; OrdersMap получает tick+target вместе) ✓;
  defensive-гвард lat/lng null в OrdersMap (только KpDialog) — даже при том, что диспетчер-кнопка
  disabled ✓; `bstudio:kp-ease` (Перелететь к КП из KpDialog) не тронут ✓.
- Мемо-компаратор OrderRow не изменён (дифф: 0 удалённых строк в его зоне; новые пропы в
  OrderRow не текут) ✓; поллинг 6с с visibility-паузой не блокирован ✓; новые state
  (kpFocusTick/kpFocusTarget/autoPlan/…) меняются только на события фокуса/диалога — лишних
  перерисовок списка нет ✓;`onKpFocusConsumed`-инлайн-стрелка даёт повторный запуск эффекта,
  но guard `if (!kpFocusArea) return` + идемпотентный easeTo делают это безвредным.

### 7. UI-инварианты
- Тач ≥44px: KpFocusButton h-11 w-11 (md:h-8 md:w-8), «Показать ещё» min-h-11, Select города
  min-h-11 sm:h-9, «Автоназначить» h-11 w-full sm:h-9, sync/CTA min-h-11 ✓.
- Dark-пары: teal (text-teal-700/hover:bg-teal-500/10 … dark:text-teal-400/dark:hover:bg-teal-500/15),
  amber-блок unmatched (border-amber-300/70 bg-amber-50 … dark:border-amber-500/30
  dark:bg-amber-500/10 dark:text-amber-300) — существующие токены, новых нет ✓.
- aria: aria-label на KpFocusButton/Select города/автоназначении-кнопке; disabled+aria-disabled
  при отсутствии координат; title «Нет координат — покажите по ссылке OSM» (pointer-events-none
  убран — title читается); role=note (кап 500, unmatched-блок), role=table/row/cell/columnheader
  в плане, role=progressbar/status ✓.
- Честные подписи: «Показаны первые 500 из N найденных — уточните поиск», «Показано N из total»,
  пустой план+unmatched → тост без диалога ✓; тост применения «Назначено: N · Не сопоставлено: M»
  (M = Σ count unmatched) ✓.

### 8. Контракты
- `bstudio:kp-focus` имя/payload совпадают: диспатч `{detail:{area}}` (areas-view:105-107) ↔
  приём `detail?.area` (app-root:762-765) ✓; полному AreaItem, city парсится приёмником при
  необходимости — согласовано в обоих worklog'ах ✓.
- `CrewDto.city` в обоих toDto (crews + crews/[crewId]) ✓; CrewAutoAssignResult поля ↔ рендер
  плана (plan/unmatched/assigned) ✓.
- studio-types/schema содержат только контрактные добавления волны (Crew.city, Conversation.closedAt,
  CrewAutoAssign*) — по worklog это зона интегратора; агенты их не трогали. Прочее в диффе:
  .clawhub/lock.json, chat.md, worklog.md — инфра/документация; посторонних файлов нет ✓.

### 9. Прогон
- `bunx tsc --noEmit` → **0 ошибок** (exit 0, весь проект).
- `bunx eslint areas-view.tsx orders-view.tsx app-root.tsx webhook.ts` → **0** (exit 0).
- dev.log: последние 200 строк без error-строк (только prisma:query/access-log); `/api/health`
  → 200, db up, inboundErrors 0.

### 10. Инварианты 23-25
- KP-слой: zoom-gate (KP_ZOOM_GATE), bbox-загрузка, дифф маркеров по lkCode, кластеры КП — не
  тронуты (в orders-view диффе нет ни одной удалённой строки из этой зоны) ✓; moveend-цепочка
  дорисует маркеры после easeTo(zoom 16 ≥ gate) ✓.
- csvCell (CSV-инъекция) не изменён ✓; pickupAt/moscowNoonUTC не тронуты ✓; orders GET total ✓;
  error-флаги state.vars (flow-engine) не в диффе ✓; атомарный updateMany-гвард IMP-25-REV-5а
  сохранён и расширен только closedAt:null ✓.

### 11. Пограничное (areas-view)
- Смена appliedQ/city → setPage(1) + смена identity `load` → replace-загрузка, накопление
  сбрасывается ✓ (пустой результат после дедупа не churn-ит state: `fresh.length === 0 → prev`).
- Двойной клик «Показать ещё»: синхронный гвард `loadingMoreRef` (иначе page+2 = молчаливый
  пропуск 100 строк) + disabled при fetching; сброс гварда в `finally` только у актуальной
  загрузки ✓; дедуп по lkCode защищает от дублей при изменении реестра между страницами ✓.
- Синк во время догрузки: syncAreas → setPage(1)+reloadKey → load(1) синхронно abort'ает
  висящую стр.-N загрузку до нового fetch — смешивания данных нет ✓; повторная синхронизация
  при page=1 срабатывает через reloadKey ✓.
- Кап 500 рендера vs «Показать ещё»: кнопка грузит дальше за капом, рендер ограничен, нотис
  честный — соответствует допущению ТЗ (см. MINOR-3 про футер).

---

## Вердикт

**Готово к интеграции.** 0 critical / 0 major / 5 minor. Верификацию golden path (клик
«Показать на карте» в реестре → перелёт + KpDialog, автоназначение dryRun→apply, экспорт CSV,
«Показать ещё» ×N) выполняет интегратор по конвейеру chat.md §2 (шаги 6-7). MINOR-1..4 —
кандидаты на дешёвые фиксы до/вместе с волной 27; MINOR-5 — informational.
