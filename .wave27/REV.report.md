# 27-REV — код-ревью волны 27 (BotStudio)

Ревьюер: 27-REV. Дата: 2026-10-09.
Методология: скилл `skills/@carolz1/code-review/SKILL.md` **не существует** на диске (проверено `ls skills/@carolz1` — каталог отсутствует; в skills/ его нет) — применена методология из ТЗ: критичность critical/major/minor, конкретные файл:строки, проверяемые утверждения (зафиксировано по правилу №2 chat.md). Прочитаны: worklog.md (секции 27-A1, 27-A2, 27-BE1, 27-BE2, 27-FE1, 27-FE2), chat.md §2–5.

## 0. Прогон (фактический)

| Проверка | Результат |
|---|---|
| `bunx tsc --noEmit` (весь проект) | **0 ошибок** (exit 0) |
| `bunx eslint` на 12 изменённых/новых файлах | **0 проблем** (exit 0) |
| `curl -s -m 3 http://localhost:3000/api/health` | `{"ok":true,"db":"up","inboundErrors":0}` — dev-сервер жив |
| dev.log, последние 150 строк | 0 error/warn/fail/exception — только prisma:query и `GET /api/health 200` |
| `git status` / `git diff --stat` | 10 код-файлов изменено (+472/−68), 2 новых (csv.ts, areas/export/) + worklog.md; снапшот БД untracked |

## 1. Вердикт

**ГОТОВО К ВЕРИФИКАЦИИ** (golden path agent-browser, мобайл 390px/десктоп, светлая/тёмная). Блокирующих дефектов нет: **critical: 0, major: 0, minor: 3** (+2 информационные заметки интегратору).

## 2. Чек-лист по IMP (сверено с кодом)

### IMP-27-01 — persistBotMessages TOCTOU (webhook.ts:393–438) — ПАСС
- Транзакция корректна: внутри callback только `tx.conversation.findUnique` (:414–419) и `tx.message.createMany` (:424–432); `maxWait 2000 / timeout 5000` (:433); замыкания `messages/conv/orderId/replies` в tx только читаются. Вложенных `$transaction` нет — единственный `db.$transaction` в webhook.ts (:411), ни один из 15 call sites (:547–:769) не сидит внутри чужой транзакции.
- `closedInFlight` обрабатывается строго ПОСЛЕ коммита: :435–437 (`messages.length = 0; return`) — до `replies.push` (:438); реплики не «доставлены-но-не-записаны». Дублирования побочных эффектов нет: `messages.length=0` встречается один раз, `replies.push` один.
- REV-5б не сломан: комментарий IMP-26-01 сохранён полностью (:393–399); снапшот-closed → штатный createMany в tx без перечитки (как раньше); открытый → fresh-check атомарен с записью.
- P2034 fail-closed: транзакция либо коммитится целиком, либо откатывается — частичной записи не остаётся; при throw `messages` НЕ очищен → движковые error-сайты BE22-01а ретраят persist (проверено: catch → `pushBot(TECH_ERROR_TEXT); await persistBotMessages()` :769). Немоторные сайты — ошибка уходит в роут, как раньше при фейле createMany (паритета поведения нет только для нового класса P2034 — целевое поведение, задокументировано :404–407).

### IMP-27-05 — автоназначение экипажа сценарием — ПАСС
- `findActiveCrewByCity` (orders.ts:404–428) 1:1 с crews/auto-assign:79–91: `where {botId, active: true, city: {not: null}}`, `orderBy name asc`, матч точный по `normalizeCityName`, «первый по name asc» ≡ «первый на нормализованный город» в роуте; пустой город/ключ → null (как пустой ключ в роуте не матчится).
- Тихий фейл не ломает создание: orders.ts:470–483 — `crewId = input.crewId ?? null`, подбор только при `!crewId && input.autoAssignCrew`, try/catch вокруг подбора, `console.warn '[orders] auto-assign…'`, `order_error` не затрагивается; INSERT один (crewId разрешён ДО цикла :484), окна «заявка без экипажа» нет; статус `'new'` не тронут (:505).
- Легаси не отвергается: flow-validate.ts:210–211 — `!== undefined && typeof !== 'boolean'` → undefined валиден; `normalizeFlow` сериализует исходный объект (`JSON.stringify(raw)` :258) и НЕ вырезает неизвестные поля → флаг переживает сохранение сценария через PUT bots/[id] (route.ts:110–116).
- Инспектор на undefined не падает: `checked={d.createOrder?.autoAssignCrew === true}` (node-inspector.tsx:291); Switch лежит внутри `{d.createOrder && …}` (:169); паттерн onChange({createOrder: {...d.createOrder, ...}}) идентичен соседним полям; выключение главного свитча удаляет createOrder целиком (:157–168) — «висячего» флага нет; Label/Switch импортированы (:10, :19).
- demo/simulate не тронуты: flow-engine.ts:808 — единственный ханк `autoAssignCrew: cfg.autoAssignCrew === true` (всегда boolean); операторский POST /orders и db.order.create (orders.ts — единственная точка :504) не дают новых путей.

### IMP-27-03 бэк — сортировка реестра (areas/route.ts:45–52, 216–225, 248–265, 284–287) — ПАСС
- near (:111–152) и bbox (:157–212) возвращаются РАНЬШЕ парса sort/dir (:216–225) — режимы карты не тронуты; `sort=dist` читается только внутри bbox-ветки (:183), конфликт архитектурно исключён; в list-режиме `sort=dist` без bbox молча → дефолт 'address'.
- Компаратор (:254–265): null-address последними в ОБЕИХ dir — гвард `if (sort === 'address' && (!a.address || !b.address))` стоит ДО инверсии `dir === 'desc' ? -c : c`, позиция null не инвертируется (:255–258); оба null → byLk; тайбрейк byLk ВСЕГДА asc (:264). Дефолт (address/asc) байт-в-байт совпадает со старым поведением.
- Эхо `sort, dir` в мете list-ответа (:284–287) аддитивно; near/bbox-ответы sort/dir не содержат; валидация белыми списками SORT_KEYS/SORT_DIRS (:48–52), невалид → дефолт без 400.

### IMP-27-04 бэк — CSV-экспорт КП (areas/export/route.ts, новый, 104 строки) — ПАСС
- Auth-порядок 1:1 с эталоном orders/export: 401 «Требуется авторизация» (:33) → rateLimit (:37–39) → 404 «Бот не найден» (:41–44) — идентично эталону (:56–66).
- Бакет `areas-csv:${user.id}` (:37) — не делится с `csv:` эталона (проверено строкой ключа).
- Кап: `truncated = list.length > EXPORT_CAP` (:85) — ровно 12000 НЕ усечение; `X-Truncated: 1` только при `if (truncated)` (:102).
- csvCell из `@/lib/csv` применён ко ВСЕМ ячейкам: строка заголовков (:88) и каждая строка данных (:90); BOM `\uFEFF` + `\r\n` (:94); Content-Disposition `kp-registry-YYYYMMDD.csv` (:99, stamp из toISOString().slice(0,10).replace(/-/g,'') как в эталоне); `Cache-Control: no-store` всегда (:100); Content-Type text/csv; charset=utf-8.
- q/city-фильтры — дословная копия list-ветки (сравнено с areas/route.ts:231–246, включая fallback `entry.lower` индекса кэша); данные из `getAreasIndexed` (сигнатура `{areas, index}` подтверждена area-match.ts:65–67).
- Route segment config (dynamic/runtime) отсутствует и в эталоне, и в новом — паритет.

### IMP-27-02 — X-Truncated UI + stale-closure (orders-view.tsx:4154–4203) — ПАСС
- 429-ветка: `res.status === 429` → тост + `return` (:4171–4177) — `return` внутри try проходит через `finally { setExporting(false) }` (:4200–4202), exporting не залипает; прочие не-ok → прежний throw → generic-тост catch.
- X-Truncated читается после ok-гварда ДО blob() (:4181), тост «Выгружены последние 5000 заявок» destructive (:4190–4196) — семантика верна (orders/export держит ПОСЛЕДНИЕ 5000 по createdAt desc, кап :133/:193–196); успех-тост прежний (:4197).
- deps (:4203): `[bot.id, dateFilter, toast, typeFilter, crewFilter]` — полный; других внешних переменных в теле нет (setExporting/gеtAuthToken стабильны). Тост-тексты консистентны с areas-view (destructive, один стиль).

### IMP-27-03/04 фронт (areas-view.tsx:147–180, 221–222, 261–269, 285–286, 303–304, 319, 362–405, 435–453, 626–637) — ПАСС
- SortableTh (:147–180): `aria-sort='ascending'|'descending'` на активной th, `scope="col"`, кнопка `type="button"` с aria-label/title, тач ≥44px (h-11 с компенсацией -mx-4/-my-2.5), иконки ArrowUpDown/ArrowUp/ArrowDown, active → text-foreground; «Координаты» не сортируется.
- onSortChange (:261–269): toggle dir / new key + asc, всегда setPage(1); replace-перезагрузка существующим эффектом `[load, page, reloadKey]` (:322–329) — механика «Показать ещё» сохранена.
- Эхо-синк (:303–304) с fallback 'address'/'asc': при старом ответе — один лишний fetch, цикла нет (второй эхо совпадает); AbortController-гигиена (:323–328) и setStates после `ac.signal.aborted`-гварда — гонок нет.
- exportAreasCsv (:362–405): raw fetch + ручной Bearer из getAuthToken (client-api.ts:10) 1:1 с эталоном; res.ok-гвард до blob(); 429 → тост + return; X-Truncated → «Выгружены первые 12000 площадок» (верно: файл — ПЕРВЫЕ 12000 в address asc); blob → ObjectURL → a.download → revokeObjectURL; deps `[botId, appliedQ, city, toast]` полны.
- Кнопка CSV (:435–453) перед «Обновить», внутри `meta.areasSyncedAt !== null`, `disabled={exporting || syncing}`, Loader2/Download, aria-label; dark-пары — только theme-токены (text-foreground, ring-ring, outline) — нарушений нет.
- RENDER_CAP=500 / PAGE_TAKE=100 / дедуп lkCode / KpFocusButton — в диффе отсутствуют (12 аддитивных ханков).

### Инфра — csv.ts + orders/export — ПАСС
- csv.ts:12–16 байт-в-байт идентичен прежней локальной функции orders/export (regex `/^[=+\-@\t]/`, `'`-префикс, `/["\r\n,]/`, удвоение кавычек — сверено построчно с удалённым кодом в диффе); IMP-25-03-гвард от CSV-инъекции сохранён.
- orders/export: из диффа только −12 (локальная функция) +2 (импорт) — контракт (BOM :213–214, X-Truncated :195–225, Content-Disposition/no-store :222–223, кап 5000 :133) не изменился; оставшихся локальных определений csvCell нет.

### Инварианты волн 23–26 — ПАСС
REV-5б-гварды целы (finish() вне диффа; diff webhook.ts = один ханк в persistBotMessages). КП-кластеризация/zoom-gate — файлов карты в диффе нет. Memo-компаратор OrderRow — не затронут (дифф orders-view = 2 ханка внутри exportCsv).

### Зоны владения — ПАСС
`git status`: ровно 10 код-файлов по зонам BE1 (webhook, flow-types/validate/engine, orders.ts, node-inspector), BE2 (areas/route.ts, areas/export/), FE1 (orders-view exportCsv), FE2 (areas-view), инфра (csv.ts, orders/export импорт) + worklog.md (аппенд секций). Чужих файлов нет. `db/snapshots/snapshot-2026-10-09-1052.db` untracked — артефакт интегратора (см. N-2).

## 3. Находки

### Critical
Нет.

### Major
Нет.

### Minor

- **MIN-1 (a11y, косметика)** `src/components/studio/areas-view.tsx:170` — aria-label активного заголовка описывает СОСТОЯНИЕ, а не действие: при active+asc кнопка читается как «Сортировать по «Адрес» — по возрастанию», хотя клик переключит на desc; скринридер-пользователь не может предсказать результат. Фикс (1 строка): для active — «Отсортировано по «Адрес» по возрастанию, нажмите для сортировки по убыванию» (hint по dir инвертировать в label'е действия). Не блокирует верификацию.
- **MIN-2 (UX-несимметрия)** `src/components/studio/areas-view.tsx:456` — кнопка «Обновить реестр» `disabled={syncing}`, но НЕ `disabled={exporting}`: во время выгрузки CSV можно запустить синк — файл выгрузится из кэша ДО синка (срез данных на момент старта экспорта). Вреда нет (кэш консистентный на момент чтения), но симметрия `exporting || syncing` на обеих кнопках честнее. Фикс: `disabled={exporting || syncing}` в :456.
- **MIN-3 (инфра/гигиена коммита)** `db/snapshots/snapshot-2026-10-09-1052.db` — untracked бинарник; .gitignore правил на db/snapshots не содержит, при этом старые снапшоты ЗАКОММИЧЕНЫ в репо (git ls-files: snapshot-2026-10-08-*.db). Интегратору осознанно решить: коммитить по практике волны 26 либо добавить в .gitignore — сейчас риск случайно протащить БД в wave-коммит без решения.

### Информационно (без действий)
- **N-1** webhook.ts:411–433 — каждый bot-reply теперь открывает интерактивную транзакцию (maxWait до 2000мс): на пике входящих SQLite сериализует записи; latency +1 tx-обертка на сообщение. Приемлемо (транзакция из 2 коротких запросов), контролировать `inboundErrors` в /api/health после деплоя.
- **N-1б** P2034 на немоторных сайтах persist (без try/catch) впервые приведёт к 500 в роут вместо тихой устаревшей записи — это задокументированное fail-closed поведение (webhook.ts:404–407), не регрессия.
- **N-2** areas/export v1: sort/dir не принимаются, updatedAt/status нет (нет в select кэша mytko.ts) — осознанные упрощения, зафиксированы в шапке файла и worklog 27-BE2.

## 4. Что проверить на верификации (не ревьюится статикой)
1. Браузерно: клики «Код КП»/«Адрес» — asc/desc, null-address последними в обе стороны, «Показать ещё» без дублей/потерь после смены сортировки; aria-sort в a11y-дереве.
2. Экспорт КП: BOM в Excel, filename, фильтры q/city; 6-я выгрузка/мин → 429-тост; X-Truncated-ветки (обе) — curl -si или мок >12000/>5000.
3. Сценарий: узел с «Экипаж автоматически» → заявка с экипажем; без совпадения по городу → заявка без экипажа + warn в логе; легаси-сценарий сохраняется и публикуется без ошибок валидации.
4. Тест «оператор закрыл диалог во время генерации ответа»: реплики не пишутся и не доставляются (REV-5б); гонка с close-роутом → P2034 fail-closed (трудновоспроизводимо — допускается проверка код-путём).
