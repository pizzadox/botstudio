# 24-REV — код-ревью волны 24 (Crew, КП-совмещение, parseWishDate, гео жалоб)

Ревьюер: general-purpose (reviewer). Код НЕ менялся. Проверка: чтение всех файлов волны + диффы (`git diff --stat`: 14 файлов, +1905/−88), смоук-тест parseWishDate (включая TZ-независимость при `TZ=America/New_York`), `npx tsc --noEmit` = 0 (подтверждено независимо).

## Находки

### IMP-24-REV-1 [major] src/app/api/bots/[id]/orders/[orderId]/route.ts:220 (+ orders-view.tsx:1488, 3234) — PATCH заявки возвращает плоский order без связей, клиент затирает ими полные DTO
`db.order.update(...)` в PATCH отдаёт скаляры без `crew`, `conversation`, `_count`. Клиент волны 24 подставляет ответ целиком: `patch()`/`runGeocode()`/`syncMytko()` делают `setOrder(d.order)` (orders-view.tsx:1488), а `attachKpToOrder` заменяет строку списка `setOrders(prev.map(o => o.id===id ? d.order : o))` (orders-view.tsx:3234). Результат после ЛЮБОГО патча в открытой карточке (например, смена статуса или «Совместить»): исчезают кнопка «Открыть диалог» (условие `order.conversation && …`, :1676), бейдж источника, «ID клиента», tel-ссылка экипажа (`order.crew?.phone`, :1975), чип «N сообщ.» в списке (нет `messagesCount`), `mytkoInfo`. Живёт до закрытия карточки / ближайшего поллинга (6 с) — UI-регресс, а не падение.
**Фикс:** в PATCH-ответе вернуть `include: { crew: {select:{id,name,phone}}, conversation: {select:{id,contact,source,externalUserId}} }` (как в GET), либо на клиенте мержить, а не заменять: `setOrder(prev => prev ? { ...prev, ...d.order, crew: d.order.crew ?? prev.crew, conversation: prev.conversation } : prev)`; в `attachKpToOrder` — такой же merge.

### IMP-24-REV-2 [major] src/app/api/bots/[id]/orders/[orderId]/route.ts:120-124 (+ crews/[crewId]/route.ts:73) — null не принимается: очистка клиента/телефона/города молча не сохраняется
Новая фича IMP-24-FE1-01 (редактирование клиента) шлёт `null` при очистке: `patch({ clientName: v || null })` (orders-view.tsx:1737), `patch({ phone: v || null })` (:1753), `patchCrew({ phone: v || null })` (CrewRow, :2348), а также `patch({ city: null })` из Select города (:1993). Бэкенд же фильтрует по `typeof body.x === 'string'` → `null` молча игнорируется, тост «Имя клиента сохранено» ложный, после перезагрузки возвращается старое значение. Для areaLkCode/crewId null-семантика реализована правильно — непоследовательность именно в старых строковых полях, активированная новым UI.
**Фикс:** `if (body.clientName !== undefined) data.clientName = typeof body.clientName === 'string' ? body.clientName.trim().slice(0,120) || null : null;` — то же для `phone`, `city` (orders PATCH) и `phone` (crews PATCH). Альтернатива — слать `''` с фронта, но контракт «null = очистить» уже заявлен в areaLkCode/crewId.

### IMP-24-REV-3 [minor] src/lib/area-match.ts:55 (+ оба area-match/route.ts:30-38) — radius не ограничен сверху
`matchAreasFor` принимает любой `radiusM > 0`: `?radius=100000000` валиден → все ~11k КП получают `byCoord` со score≈1. В areas-роуте радиус capped 2000, здесь — нет (семантическая дыра и несогласованность лимитов; не DoS — проход тот же).
**Фикс:** в `matchAreasFor`: `const radiusM = Math.min(Math.max(opts?.radiusM ?? DEFAULT_RADIUS_M, 1), 2000);`

### IMP-24-REV-4 [minor] src/lib/area-match.ts:84 — токенизация 11k адресов заново на каждый запрос
`new Set(addressTokens(a.address))` внутри цикла — нормализация+сплит+Set на все ~11k КП при каждом GET area-match (и в саджесте карточки это на каждый патч заявки — эффект по `updatedAt`). Десятки мс, не блокер, но кэш дешёвый.
**Фикс:** кэшировать токены вместе с areas в `getAreasCached` (например, Map lkCode→Set) или module-level WeakMap по массиву areas из кэша.

### IMP-24-REV-5 [minor] src/components/studio/orders-view.tsx:361-374 — слой КП: нет abort при размонтировании и устаревшие маркеры при смене бота
`kpAbortRef.current?.abort()` вызывается только при выключении слоя; при размонтировании OrdersMap in-flight bbox-запрос не отменяется (setKpAreas после unmount — в React 18 безопасный no-op, но запрос зря летит), а при смене бота (`loadKpAreas` в deps эффекта перезапускается) маркеры предыдущего бота живут до ответа нового bbox (~сек).
**Фикс:** в cleanup эффекта `[ready, kpEnabled, loadKpAreas]` добавить `return () => { kpAbortRef.current?.abort(); if (kpDebounceRef.current) clearTimeout(kpDebounceRef.current); }`; при смене botId сбрасывать `kpAreas`/`kpTotal` (эффект по `botId`).

### IMP-24-REV-6 [minor] src/lib/flow-engine.ts:739-742 — writeback human-даты в dateVar-шаблон с несколькими переменными затирает первую
`varName` извлекается первым `exec` из `/\{\{\s*([\w.]+)\s*\}\}/`. Если оператор в поле dateVar написал шаблон «{{city}}, {{when}}» — human-строка запишется в `state.vars['city']`. Ожидаемый кейс — один плейсхолдер (или голое имя переменной — тогда всё корректно), но защиты нет.
**Фикс:** писать только если шаблон содержит ровно один плейсхолдер (`match()` длиной 1), иначе — не перезаписывать (оставить raw).

### IMP-24-REV-7 [minor] src/components/studio/complaints-view.tsx:195-208 — loadMatch без AbortController
«КП рядом…» гоняет GET area-match без отмены: быстрый toggle/скролл с мобильного создаёт параллельные запросы; ответ устаревшего запроса спокойно пишется в state (карточка своя, поэтому это только лишние запросы и моргание лоадера, не подмена данных чужой карточки). В отличие от заявочного саджеста, где abort реализован (orders-view.tsx:1464-1477).
**Фикс:** AbortController в `loadMatch` + `ac.abort()` при повторном toggle/размонтировании (паттерн из orders-view).

### IMP-24-REV-8 [minor] src/app/api/bots/[id]/complaints/[complaintId]/route.ts:105-127 — при уже имеющихся координатах смена адреса оставляет старую точку; lat/lng жалобы вообще нельзя исправить вручную
PATCH пишет адрес и геокодит только если `lat==null && lng==null`. Если координаты есть (пришли из последней заявки), а оператор уточнил адрес — точка расходится с адресом без какого-либо способа пересчитать/поставить вручную (у жалоб нет PATCH lat/lng, в отличие от заявок). Не блокер: саджест КП по адресу продолжит работать.
**Фикс:** принять `body.geocode === true` (пересчёт по адресу, как у заявок) и/или опциональные `lat/lng` с `Number.isFinite` — фронт добавит кнопку «Геокодировать» в inline-редактор.

## Что проверено и в порядке (по чек-листу)

1. **Безопасность** — crews CRUD, orders/complaints area-match, PATCH-расширения: везде `getSessionUser` + `bot.userId === user.id`, вложенные сущности дополнительно скоупятся по `botId` (crew: `crew.botId === botId`; areaLkCode: `findFirst({botId, lkCode})`; crewId: `findFirst({id, botId})`); 401/404/400 консистентны с orders-эталоном. Сырых SQL-конкатенаций нет (Prisma-параметры). Утечек в ответах нет (crews/_count, area-match отдают только поля DTO).
2. **Валидация** — crews name 1..120 (trim, пустое → 400), phone ≤20, notes ≤300; areaLkCode/crewId чужого бота → 400; bbox: ровно 4 числа, `Number.isFinite` (NaN/Infinity отвергаются), min≤max, cap 1000; near: radius cap 2000, limit cap 20; take caps сохранены; Complaint address ≤300 (POST+PATCH, пустой в PATCH → 400).
3. **Движок** — parseWishDate: TZ Europe/Moscow через `Intl.DateTimeFormat('en-CA')`, подтверждено тестом при `TZ=America/New_York` («завтра» → 12:00 MSK следующего дня); «послезавтра»/дни недели/«до 12:00» — смоук 9 кейсов зелёный, «до 23.10» не спутывается со временем. Writeback `state.vars[varName] = human` выполняется ДО `interpolate(node.data.text, …)` (тот же case 'message', текст интерполируется в конце ветки) — «{{date}}» в ответе клиенту показывает human-строку. Создание жалобы не падает от геокода (geocodeAddress никогда не throw + собственный try/catch). clientName fallback = `conversation.contact` ✓.
4. **Контракты** — orders список и карточка отдают crew/crewId/areaLkCode/areaAddress/pickupAt; complaints DTO (список и PATCH) отдают address/lat/lng/areaLkCode/areaAddress; PATCH order при wishDate пишет и pickupAt; PATCH areaLkCode пишет areaAddress-снимок; null/'' = открепить для areaLkCode/crewId ✓. Исключения — находки REV-1/REV-2.
5. **React** — deps эффектов корректны: area-match карточки кэшируется по `id:updatedAt` (лишних рефетчей при поллинге нет, AbortController есть); KP-слой — собственные ref'ы (spiderfy/кластеры волны 23 не тронуты), дифф-рендер по lkCode, снятие маркеров при выключении слоя, debounce 600 мс; ключи списков стабильны (id/lkCode); тёмная тема — все новые элементы с `dark:` вариантами; aria-label/title у иконочных кнопок; touch ≥44px на мобильных (min-h-11/h-11). Волна 23 не сломана: supercluster/spiderfy/moveend-пересчёт, пагинация жалоб курсором с дедупом, поллинг 6с/8с с паузой на document.hidden — на месте. Оптимистичные апдейты жалоб с полным откатом (items + counts) ✓.
6. **Производительность** — area-match один проход по кэшу ~11k (см. REV-4 про токены); bbox debounce 600 мс + cap 1000 + дифф маркеров без пересоздания; карточка заявки не рефетчится при поллинге списка; crews без поллинга (загрузка на open).
7. **Prisma** — `@@index([botId, crewId])` и `@@index([botId, active])` добавлены; `Order.crew onDelete: SetNull` в схеме — после DELETE crew UI не покажет битых ссылок (crewId=null, Select показывает «Без экипажа»); выборка списка использует индексы botId+…; миграция схемы через `prisma db push` (папки migrations нет — соответствует текущему процессу проекта).

## Сводка

**0 critical / 2 major / 6 minor.**

## Вердикт

**Одобряю с правками (approve with changes).** Критичных дыр нет: безопасность новых эндпоинтов образцовая, валидация/капы на месте, parseWishDate корректен и TZ-независим (проверено тестом), Prisma-схема с индексами и SetNull, фичи волны 23 не регрессировали. Два major — не про безопасность, а про целостность UI-контракта волны 24: (1) PATCH orders возвращает плоский order, которым фронт затирает связанные поля карточки/строки списка; (2) очистка clientName/phone/city/crew-phone через `null` молча не работает (фронт волны 24 уже шлёт null). Оба фиксятся точечно (~10 строк) без смены архитектуры и рекомендованы к включению в волну 25 или hotfix; minor-находки можно отложить.
