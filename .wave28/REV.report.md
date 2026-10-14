# REV.report — волна 28 «Emerald Glass», Task ID 28-REV

**Reviewer:** general-purpose (Reviewer волны 28)
**Дата:** 2026-10-12 · **Метод:** git diff/status всех изменённых зон, разбор живого CSS дев-сервера, изолированное воспроизведение каскада (tailwindcli + lightningcss), math-скрипты oklch→sRGB→WCAG, `bunx tsc --noEmit`, `bun run lint`, dev.log.
**Зоны ревью:** 28-DS (globals.css, layout, ui/*), 28-FEA (shell/app-root/login/dashboard), 28-FEB (editor/flow-node/palette/inspector/test-chat/channels/assistant), 28-FEC (inbox/complaints/areas), 28-FED (orders-view + /w/[secret]/route.ts). Untracked db-снапшоты/.archive/download-* — вне зоны.

## ВЕРДИКТ: **APPROVE** — условный: P1-1 и P1-2 чинить в этой волне до коммита. P0 отсутствует.

Ни один контракт не сломан, логика/данные/memo/aria не тронуты, tsc=0, lint=0. Найдено 2 точных P1
(оба — 1-2 строки) и 7 пунктов бэклога.

---

## P0 (блокеры) — не найдено

---

## P1 (чинить в этой волне)

### P1-1. `src/app/globals.css:225-239` — blur glass/glass-strong НЕ работает в Firefox (стандартный `backdrop-filter` выброшен из компилята)

**Факт (живой CSS дев-сервера, chunk `[root-of-the-server]__…_.css`, строки 4366-4380):**

```css
.glass {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); /* стандартного backdrop-filter НЕТ */
  box-shadow: var(--glass-shadow);
}
```

В исходнике (:228-229) стандартный `backdrop-filter` объявлен ПЕРВЫМ, `-webkit-backdrop-filter` — вторым.
Next.js post-обрабатывает CSS lightningcss'ом с таргетами и **дедуплицирует alias-пару, оставляя последнюю
декларацию группы**. Изолированно воспроизведено (`lightningcss.transform`, targets chrome 111/firefox 128/safari 16):

- порядок `backdrop-filter; -webkit-backdrop-filter` → на выходе **только `-webkit-`** (как сейчас);
- порядок `-webkit-backdrop-filter; backdrop-filter` → **оба свойства** сохраняются.

Firefox не поддерживает `-webkit-backdrop-filter` (только стандартный) → вся волна «Emerald Glass»
в Firefox рендерится без blur (панели остаются полупрозрачными — читаемо, но эффекта стекла нет).
Chromium/Edge/Safari не задеты (поддерживают -webkit- алиас). Core-утилиты (`backdrop-blur-md` у тостов,
`dark:backdrop-blur` у оверлеев orders) не пострадали — Tailwind кладёт туда обе декларации в правильном порядке.

**Фикс:** в `@utility glass` (globals.css:228-229) и `@utility glass-strong` (:236-237) поменять строки местами —
`-webkit-backdrop-filter` первой, `backdrop-filter` (стандартный) последней. Проверить после фикса в живом CSS:
у `.glass` должны быть оба свойства.

### P1-2. `src/app/globals.css:57-58` — контраст primary/primary-foreground (light) = **4.44:1 < 4.5** (WCAG AA, normal text)

Math-пересчёт (oklch→линейная sRGB→WCAG, bun-скрипт, конвертер сверен по старому значению: 0.596 → 3.51-3.58 ✔):

| пара | контраст |
|---|---|
| primary oklch(0.535 0.145 163.225) (#008654) vs **--primary-foreground oklch(0.985 0 0)** (#fafafa) — реальная пара токенов | **4.44** ❌ |
| тот же primary vs чистый белый #ffffff | 4.64 ✔ (это число и попало в doc как «4.60:1») |
| dark primary oklch(0.72) vs dark fg oklch(0.18) | 8.02 ✔ |

28-DS проверял math против «белого текста» (#fff), но токен `--primary-foreground` = oklch(0.985 0 0) — на нём
сидят все кнопки default/CTA, активные пункты навигации, активные чипы фильтров (текст 14px medium = normal text,
порог 4.5). Промах ~1.5% — на грани, но формально ниже AA, а задокументированное «4.60:1 с белым текстом»
(docs/design-system-w28.md:12) не соответствует реальной паре токенов.

**Фикс (минимальный):** `--primary-foreground` (light) → `oklch(1 0 0)` → 4.64:1 ✔ (визуально неотличимо).
Альтернатива — углубить primary до ~0.528. После фикса синхронизировать числа в docs/design-system-w28.md:12-13
и комментарий в globals.css:46-47.

---

## P2 (бэклог IMP-28-XX)

### P2-1. `src/components/studio/editor-view.tsx:760,772` — десктоп-обёртки инспектора и тест-чата остались без фона
Корни NodeInspector (:91) и TestChat (:245) сделаны прозрачными «в расчёте на стекло обёртки» (заявлено в worklog 28-FEB),
но обёртки — `w-80 shrink-0 border-l` (и `xl:w-96`), т.е. **фона/стекла не имеют**: колонки висят прямо на пятнах
body::before. Читаемость в норме (muted-fg на подложке 5.14-5.31:1 light, 6.59:1 dark — math), mobile-Sheet-варианты
ок (SheetContent уже стекло), но соседняя колонка палитры — `glass`, а эти две «голые» → разнобой системы поверхностей.
Фикс: `glass` (или блюр-фри `bg-card/85`) на обе обёртки + правка формулировки в worklog 28-FEB при следующей итерации.

### P2-2. Перф: неограниченное число backdrop-filter в длинных списках
- `orders-view.tsx:4575` — таб-список рендерит **все** отфильтрованные заявки без капа; каждая OrderRow = `glass`
  (backdrop-blur 12px). На проде сотни активных заявок → сотни backdrop-слоёв.
- `areas-view.tsx:53,691` — мобильные карточки КП: до `RENDER_CAP = 500` стеклянных `<article>`.

glass-hover сам по себе transform/shadow (требование ревью выполнено ✔), но базовый blur на сотнях элементов — риск
скролла на слабых/мобильных. Предложение: блюр-фри вариант строки (`bg-card/85 + border`, как flow-node.tsx:118 —
без backdrop-filter) для строк длинных списков, blur оставить контейнерам; либо кап/виртуализация. В demo-объёмах
деферрится в бэклог.

### P2-3. `node-palette.tsx:51,97` — glass-hover (translateY −1px) на drag-источниках палитры
Проверить браузерно, что dragstart не срывается (hover-сдвиг 1px меньше drag-threshold, но на тач-устройствах
позиция пальца ≠ позиция курсора). Плюс 10-12 backdrop-filter чипов рядом с живым канвасом — замерить FPS на мобиле.

### P2-4. Смешан стиль important-модификатора
`dashboard.tsx:330` — leading `!border-dashed` (легаси), `orders-view.tsx` — trailing `border-amber-300/70!` (канон v4).
Оба компилируются (проверено: `.\!border-dashed` @2638 и `.border-amber-300\/70\!` @2678 скомпилированы с !important),
но для единообразия — унифицировать на trailing-`!` в следующей волне.

### P2-5. Mode-only диффы (100644→100755) на ~25 файлах вне зон волны
`src/app/api/**`, `src/lib/*.ts`, `src/app/error.tsx` и др. — только смена правок exec-bit, 0 строк контента. Попадут в
коммит волны как шум; нормализовать (`chmod 644`) или осознанно закоммитить.

### P2-6. Декоративные точки без dark-пар (косметика)
`dashboard.tsx:627` (bg-amber-500), `channels-view.tsx:1240,1248` (bg-emerald-500 / bg-amber-500 внутри новых чипов) —
на тонированных чипах читаемы и в dark, но для единообразия с `dashboard.tsx:458` (там пары добавлены) можно добавить
`dark:bg-*-400`. Чисто консистентность.

### P2-7. Документация каскадного контракта
В docs/design-system-w28.md (и в шаблон @utility) зафиксировать: (а) порядок деклараций в alias-парах —
`-webkit-*` первой (см. P1-1), иначе lightningcss роняет стандартное свойство; (б) обновить заявленный контраст
primary после P1-2. Это убережёт волны 29+ от повторения.

---

## Проверено и ОК (по пунктам ТЗ)

1. **Контрактность ✔** — ui-примитивы: только className/cva (пропсы, forwardRef, VariantProps не тронуты; Card API тот же,
   glass+rounded-2xl внутри); toast: `variant` расширен через cva → `ToastProps` (`use-toast.ts` — 0 диффов, 133 `toast()`
   call-site совместимы; Radix `duration` call-site (app-root:502-523, 8000) перебивает provider 5000); memo-компараторы —
   0 ханков в диффе (OrderRow :3706-3729, ConversationRow/MessageBubble/ComplaintCard/FlowCard — менялись только className
   строк рендера); inline `style={{left}}` Handle'ов (flow-node.tsx:203/214/227) ✔; маркеры карты orders-view :111-184,
   NODE_COLOR_MAP, CLUSTER_EL_CLASS — 0 ханков ✔; aria-sort (3, areas), aria-current (ConversationRow :269), aria-label,
   тач-таргеты h-11 (оверлеи карты, чипы, палитра min-h-11) сохранены ✔; тексты/обработчики/логика — без изменений.
2. **Тёмная тема ✔** — все новые фикс-палитры с корректными dark-парами 1:1 (emerald/amber/rose/teal/violet/slate
   500/10-15 ↔ text-*-700/400; счётчики по классам сошлись); 8 оверлеев карты `glass-strong … dark:bg-background/95
   dark:backdrop-blur` — осознанно (карта liberty всегда светлая); `bg-emerald-950/40` оверлеи — тёмный скрим в обеих
   темах (норма для модалок); token-классы (bg-background/50, bg-muted/40-50, bg-card/85+dark:/90) адаптируются через
   токены. Сирот без dark-пар в новом коде не найдено (точечные исключения — P2-6, задокументированные).
3. **Контраст/читаемость ✔** (кроме P1-2) — счётчик активного чипа жалоб `bg-black/10` = **5.28:1** (старый `bg-white/20`
   = 3.19:1 — фикс FEC подтверждён math), dark `white/15` = 9.07:1; muted-foreground на стекле: light 5.14-5.31:1
   (включая самое яркое пятно + glass), dark 6.59:1; тосты bg-background/80+backdrop-blur, destructive/95; лоадер и
   логин-карточка на стекле читаемы; остатки `white/20` — только channels-view:829 (кружок на фикс-градиенте
   emerald-600→teal-600, решение документировано агентом) ✔.
4. **CSS-каскад ✔** (с оговоркой P1-1) — в живом CSS `.glass`@4366/.glass-strong@4373 идут ПОСЛЕ `.border-amber-300\/70`@2668
   и `.bg-primary\/5`@3320 (research 28-FED подтверждён); trailing-`!` (`border-amber-300/70!`, `bg-primary/5!`,
   `bg-teal-500/10!`, `bg-muted!`, `hover:bg-teal-500/15!`) скомпилированы с !important; tint-бЕЗ-`!` поверх glass **на том же
   элементе** не найдено: все conditional-тинты на стеклянных элементах имеют `!`, остальные тинты лежат на дочерних
   элементах (chips/thead) или используют hover:/dark: варианты (позже + специфичнее) ✔.
5. **Перф ✔** (оговорки — P2-2/P2-3) — blur НЕ появился на маркерах карты, flow-node (bg-card/85, без backdrop-filter),
   строках таблиц areas (hover-only), списке диалогов inbox (hover-only); areas-таблица — glass 1 раз на контейнере;
   glass-hover = transition+transform+box-shadow, НЕ backdrop-filter (требование ревью выполнено); reduced-motion гасит
   transform/transition glass-hover (скомпилировано @8931) ✔; пузыри OrderChat — bg-card/bg-primary без blur ✔.
6. **Виджет route.ts ✔** — template literal цел: «`» и «${» встречаются только в JS-комментарии :12 ВНЕ шаблона; 13
   маркеров `/* IMP-28-FED */` — валидные CSS-комментарии; двойные кавычки не внесены; tsc/lint зелёные; новые цвета
   (#0e241a на белом ≈16:1, фокус #059669, чипы #d2e7db) контрастны; glass в виджет не протащен (гайд §4.8) ✔.
7. **globals.css ✔** — старые правила сохранены (maplibregl-marker:focus-visible и react-flow handle синхронизированы на
   0.535, `:where` focus-сетка, скроллбары затонированы, reduced-motion расширен — ничего не удалено); `@utility` синтаксис
   корректен (glass-hover с вложенным `&:hover` компилируется); body::before `z-index:-1; pointer-events:none` — контент
   не перекрывает (фон body уходит на canvas → пятна видимы; html фон не задан — проверено) ✔.
8. **a11y** — skip-link на месте (layout.tsx:46-48 → `main#main-content` shell.tsx:401) ✔; иконки/полоска тостов
   aria-hidden ✔; контраст primary — см. P1-2 (единственный промах).
9. **bunx tsc --noEmit = 0 ✔; bun run lint = 0 ✔; dev.log чист (только prisma:query), /api/health 200 ✔.**

Дополнительно: контентных изменений вне заявленных зон нет (api/**/lib/**/error.tsx — только mode-биты, см. P2-5);
untracked-файлы тикетов из стартового состояния волны отсутствуют в статусе — чужие зоны не задеты.
