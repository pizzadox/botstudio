# Дизайн-система «Emerald Glass» (волна 28, IMP-28-DS) — гайд для view-агентов

Фундамент свёрстан в токенах и примитивах (`globals.css`, `ui/*`). View-агенты ПОЛЬЗУЮТСЯ
этим, а не изобретают свои стили. Тема через `next-themes` (class, light/dark).

## 1. Токены (globals.css)

| Токен | Light | Dark | Семантика |
|---|---|---|---|
| `--background` | `oklch(0.988 0.005 165)` | `oklch(0.17 0.02 165)` | бело-зелёная база / зелёно-графит |
| `--card` / `--popover` | `oklch(0.995 0.003 165)` | `oklch(0.21 0.022 165)` | поверхности |
| `--primary` | `oklch(0.535 0.145 163.225)` (4.60:1 с белым текстом — math проверен) | `oklch(0.72 0.14 163)` | фирменный зелёный, КНОПКИ-CTA |
| `--primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.18 0.03 165)` | текст на primary (8.02:1 в dark) |
| `--secondary` / `--muted` | `oklch(0.965 0.012 165)` | `oklch(0.26 0.018 165)` | вложенные подложки (затонированы) |
| `--accent` | `oklch(0.955 0.02 165)` | `oklch(0.27 0.025 165)` | hover-подложки |
| `--border` / `--input` | `oklch(0.9 0.012 165)` | `oklch(0.85 0.05 165 / 18-22%)` | тёплый зелёно-серый |
| `--ring` | `oklch(0.696 0.142 163)` | `oklch(0.696 0.142 163)` | фокус, всегда зелёный |

Тело страницы уже украшено фиксированными зелёными пятнами (`body::before`) — НЕ рисовать
свои градиенты на body/main.

## 2. Glass-утилиты (Tailwind 4 `@utility`, полностью на `--glass-*` переменных)

- `glass` — лёгкое стекло (light: белый 62% + blur 12px saturate 1.4; dark: белый 7%).
  Для: обычные стеклянные панели, вложенные контейнеры, чип-строки. Card уже `glass`.
- `glass-strong` — плотное стекло (light: 86%, blur 20px saturate 1.6; dark: белый 12%).
  Для: шапки/хедер-полосы, панели ПОВЕРХ карты, sticky-панели, мобильные шиты.
- `glass-hover` — hover-подъём (translateY(-1px) + тень strong). Вешать ПОВЕРХ `glass`.
  Гасится prefers-reduced-motion автоматически.

## 3. Всплывающие уведомления (toasts)

`use-toast` API НЕ менялся (137 call-sites работают как раньше). Теперь дефолт `duration=5000`.

Варианты (в т.ч. НОВЫЕ): `default` | `success` | `warning` | `info` | `destructive`.
Иконка + цветная полоска слева ставятся автоматически (toaster.tsx).
Пример: `toast({ title: 'Сохранено', variant: 'success' })`.
Правило: успех → success, предупреждение (rate-limit, частичные сбои) → warning,
инфо/нейтрально-информационное → info, ошибка → destructive (как раньше).

## 4. Правила применения (ОБЯЗАТЕЛЬНО)

1. **Dark-пары обязательны** для каждого bg/border/text: `bg-primary/10 dark:bg-primary/15`.
2. **НЕ blur-ить**: маркеры карты (`.maplibregl-marker`), узлы React Flow, `<canvas>` карты.
   Blur только на контейнерах-панелях ПОД/НАД ними.
3. **НЕ трогать** memo-компараторы, data-модель, use-toast API, sonner.tsx.
4. **Тач-таргеты h-11 (≥44px)** на мобиле — сохранять при любых заменах классов.
5. **Чипы/tint-фоны**: `bg-primary/10 text-primary dark:bg-primary/15` — вместо
   `bg-emerald-100 text-emerald-800` (фиксированные палитры не скейлятся в dark).
   Прочие цвета — по схеме `bg-*-500/10 … dark:bg-*-400/10` + `border-*-500/30`.
6. **Геометрию не анимировать** (hover:scale запрещён давно) — для подъёма есть `glass-hover`.
7. Скругления: карточки/панели `rounded-2xl` (Card уже такой), вложенные блоки `rounded-xl`,
   чипы `rounded-full`.
8. Виджет `/w/[secret]` стилей этой волны не наследует (у него свой изолированный CSS) — не тащить glass туда.

## 5. Шаблоны «до → после»

Хедер-полоса (sticky поверх контента):
```
- className="sticky top-0 z-30 bg-background border-b"
+ className="sticky top-0 z-30 glass-strong border-b"      {/* border-b оставить для чёткой кромки */}
```

Обычная карточка:
```
- <Card className="bg-card border shadow-sm">
+ <Card>                                                    {/* уже glass + rounded-2xl из card.tsx */}
```

Вложенная панель (внутри карточки):
```
- <div className="bg-muted/40 rounded-xl border">
+ <div className="glass rounded-xl">                        {/* или bg-muted/40 — допустимо, токен уже зелёный */}
```

Чип статуса:
```
- <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
+ <Badge className="bg-primary/10 text-primary border-primary/30 dark:bg-primary/15 dark:border-primary/30">
```

Кнопка-иконка (ghost):
```
- <Button variant="ghost" className="hover:bg-accent">
+ <Button variant="ghost">                                  {/* hover уже зелёный tint из button.tsx */}
```

Тост:
```
- toast({ title: 'Канал подключён' })
+ toast({ title: 'Канал подключён', variant: 'success' })
```

## 6. Что уже сделано в примитивах (НЕ дублировать в view)

card.tsx (glass), dialog.tsx / sheet.tsx (плотное стекло + emerald-950/40 оверлей),
dropdown-menu.tsx / select.tsx (стеклянные поповеры), command.tsx (палитра на стекле),
table.tsx (полупрозрачная шапка, зелёный hover строк), button.tsx (outline/ghost),
input.tsx / textarea.tsx (bg-background/60), toast.tsx + toaster.tsx (варианты + иконки),
globals.css (токены, body::before, glass-утилиты, зелёные скроллбары, reduced-motion).
