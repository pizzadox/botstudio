'use client';

import type { ReactNode } from 'react';
import {
  Bot,
  Inbox,
  LayoutDashboard,
  LogOut,
  MapPin,
  MapPinned,
  MessageCircleWarning,
  Moon,
  MoreVertical,
  Search,
  Sun,
  UserRound,
  Workflow,
  Plug,
  Sparkles,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import type { SessionUser, ViewKey } from '@/lib/studio-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// IMP-23-TAB-02: вкладки «Обращения» и «Реестр КП» (после «Заявки»).
// mobileInMore: на 390px в хедере не хватает места на 8 иконок — эти разделы
// на мобиле живут в «Ещё»-меню (см. MobileMoreMenu).
const NAV: {
  key: ViewKey;
  label: string;
  icon: typeof LayoutDashboard;
  hint: string;
  mobileInMore?: boolean;
}[] = [
  { key: 'dashboard', label: 'Дашборд', icon: LayoutDashboard, hint: 'Список ваших ботов' },
  { key: 'editor', label: 'Конструктор', icon: Workflow, hint: 'Сценарий бота на канвасе' },
  { key: 'ai', label: 'ИИ-ассистент', icon: Sparkles, hint: 'Личность ИИ и база знаний' },
  { key: 'channels', label: 'Каналы', icon: Plug, hint: 'MAX, Telegram, WhatsApp, сайт и MyTKO' },
  { key: 'inbox', label: 'Входящие', icon: Inbox, hint: 'Диалоги с клиентами и обращения' },
  { key: 'orders', label: 'Заявки', icon: MapPin, hint: 'Заявки на карте, статусы, архив' },
  { key: 'complaints', label: 'Обращения', icon: MessageCircleWarning, hint: 'Жалобы клиентов', mobileInMore: true },
  { key: 'areas', label: 'Реестр КП', icon: MapPinned, hint: 'Контейнерные площадки MyTKO', mobileInMore: true },
];

/** Красный счётчик на пункте навигации */
function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white tabular-nums">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * Тумблер тёмной/светлой темы (next-themes).
 * Обе иконки лежат в DOM, а видимость решает CSS-класс темы на <html>
 * (dark:hidden / hidden dark:block) — hydration-safe без mounted-гварда:
 * next-themes ставит класс блокирующим скриптом ещё до первой отрисовки.
 */
function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Переключить тёмную тему"
      title="Переключить тёмную тему"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
    >
      <Moon className="h-4 w-4 dark:hidden" aria-hidden="true" />
      <Sun className="hidden h-4 w-4 dark:block" aria-hidden="true" />
    </button>
  );
}

/**
 * Мобильное «Ещё»-меню (IMP-FE21-02): тумблер темы, палитра команд и выход —
 * раньше на мобиле были недоступны (в хедере физически не было слота).
 * Заменяет прежнюю кнопку «Выйти» — количество кнопок в хедере не выросло.
 */
function MobileMoreMenu({
  onOpenPalette,
  onOpenProfile,
  onLogout,
  navItems,
  currentView,
  onNav,
}: {
  onOpenPalette?: () => void;
  /** Открыть диалог «Профиль» (смена пароля) — перед «Выйти» (IMP-FE22-23) */
  onOpenProfile?: () => void;
  onLogout: () => void;
  /** IMP-23-TAB-02: разделы, не влезающие в мобильный хедер (иконки 390px) */
  navItems?: { key: ViewKey; label: string; icon: typeof LayoutDashboard; badge: number }[];
  currentView?: ViewKey;
  onNav?: (v: ViewKey) => void;
}) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Ещё"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {/* IMP-23-TAB-02: новые разделы на мобиле — в «Ещё»-меню */}
        {navItems && navItems.length > 0 && onNav && (
          <>
            <DropdownMenuLabel>Разделы</DropdownMenuLabel>
            {navItems.map((n) => (
              <DropdownMenuItem key={n.key} onSelect={() => onNav(n.key)}>
                <n.icon aria-hidden="true" />
                <span className="flex-1">{n.label}</span>
                {currentView === n.key && (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">текущий</span>
                )}
                <Badge count={n.badge} />
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        {/* resolvedTheme читается только внутри контента меню — Radix рендерит
            его в портал в момент открытия (после гидратации), поэтому, как и у
            десктоп-тумблера, mounted-гвард не нужен. */}
        <DropdownMenuRadioGroup
          value={resolvedTheme}
          onValueChange={(v) => setTheme(v as 'light' | 'dark')}
        >
          <DropdownMenuRadioItem value="light">
            <Sun className="h-4 w-4" aria-hidden="true" /> Светлая тема
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="h-4 w-4" aria-hidden="true" /> Тёмная тема
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {onOpenPalette && (
          <DropdownMenuItem onSelect={() => onOpenPalette()}>
            <Search aria-hidden="true" />
            <span className="flex-1">Палитра команд</span>
            <DropdownMenuShortcut aria-hidden="true">Ctrl K</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
        {/* IMP-FE22-23: «Профиль» на мобиле доступен из «Ещё»-меню */}
        {onOpenProfile && (
          <DropdownMenuItem onSelect={() => onOpenProfile()}>
            <UserRound aria-hidden="true" />
            Профиль
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onLogout}>
          <LogOut aria-hidden="true" />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Shell({
  user,
  view,
  onViewChange,
  currentBot,
  onLogout,
  badges,
  onOpenPalette,
  onOpenProfile,
  children,
}: {
  user: SessionUser;
  view: ViewKey;
  onViewChange: (v: ViewKey) => void;
  currentBot: { id: string; name: string } | null;
  onLogout: () => void;
  badges?: { inbox?: number; orders?: number; complaints?: number };
  /** Открыть палитру команд (Ctrl+K) — триггер в сайдбаре возле навигации */
  onOpenPalette?: () => void;
  /** Открыть диалог «Профиль» (IMP-FE22-23): кнопка-блок в сайдбаре */
  onOpenProfile?: () => void;
  children: ReactNode;
}) {
  // IMP-23-TAB-02: complaints — новые жалобы из /api/notifications; areas — без бейджа
  const badgeFor = (key: ViewKey): number =>
    key === 'inbox'
      ? (badges?.inbox ?? 0)
      : key === 'orders'
        ? (badges?.orders ?? 0)
        : key === 'complaints'
          ? (badges?.complaints ?? 0)
          : 0;

  const moreNavItems = NAV.filter((n) => n.mobileInMore).map((n) => ({
    key: n.key,
    label: n.label,
    icon: n.icon,
    badge: badgeFor(n.key),
  }));

  return (
    <TooltipProvider delayDuration={350}>
      <div className="h-dvh overflow-hidden flex flex-col bg-muted/40">
        {/* Мобильный хедер */}
        <header className="md:hidden flex items-center justify-between border-b bg-background px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Bot className="h-4 w-4" />
            </div>
            <span className="hidden font-bold sm:inline">BotStudio</span>
          </div>
          <nav aria-label="Разделы студии" className="flex items-center gap-0.5">
            {/* На мобиле показываем только первые иконки; остальные — в «Ещё»-меню (IMP-23-TAB-02) */}
            {NAV.filter((n) => !n.mobileInMore).map((n) => (
              <Tooltip key={n.key}>
                <TooltipTrigger asChild>
                  <button
                    aria-label={n.label}
                    aria-current={view === n.key ? 'page' : undefined}
                    onClick={() => onViewChange(n.key)}
                    className={cn(
                      'relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      view === n.key
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-muted'
                    )}
                  >
                    <n.icon className="h-4 w-4" />
                    <Badge count={badgeFor(n.key)} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{n.label}</TooltipContent>
              </Tooltip>
            ))}
            <div aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
            {/* «Ещё»-меню вместо отдельной кнопки «Выйти» — тема/палитра/профиль/выход (IMP-FE21-02, IMP-FE22-23)
                + разделы, не поместившиеся в хедер (IMP-23-TAB-02) */}
            <MobileMoreMenu
              onOpenPalette={onOpenPalette}
              onOpenProfile={onOpenProfile}
              onLogout={onLogout}
              navItems={moreNavItems}
              currentView={view}
              onNav={onViewChange}
            />
          </nav>
        </header>

        <div className="flex flex-1 min-h-0">
          {/* Десктопный сайдбар */}
          <aside className="hidden md:flex h-full w-60 shrink-0 flex-col border-r bg-background">
            <div className="flex items-center gap-3 px-5 py-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-emerald-600/20">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <div className="font-bold leading-tight">BotStudio</div>
                <div className="text-xs text-muted-foreground">визуальный конструктор</div>
              </div>
            </div>

            <nav aria-label="Разделы студии" className="flex-1 space-y-1 px-3">
              {NAV.map((n) => (
                <div key={n.key} className="relative">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onViewChange(n.key)}
                        aria-current={view === n.key ? 'page' : undefined}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          view === n.key
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <n.icon className="h-4 w-4" />
                        <span className="flex-1 text-left">{n.label}</span>
                        <Badge count={badgeFor(n.key)} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{n.hint}</TooltipContent>
                  </Tooltip>
                  {view === n.key && (
                    <span
                      aria-hidden="true"
                      className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary"
                    />
                  )}
                </div>
              ))}
            </nav>

            {/* Палитра команд (Ctrl+K) — сразу под навигацией (десктоп) */}
            {onOpenPalette && (
              <div className="px-3 pb-1">
                <button
                  type="button"
                  onClick={onOpenPalette}
                  aria-label="Палитра команд (Ctrl+K)"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  <span className="flex-1 text-left">Палитра команд</span>
                  <kbd
                    aria-hidden="true"
                    className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-muted-foreground"
                  >
                    Ctrl K
                  </kbd>
                </button>
              </div>
            )}

            {currentBot && (
              <div className="mx-3 mb-3 min-w-0 rounded-xl border bg-muted/50 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Текущий бот
                </div>
                <div className="mt-1 min-w-0">
                  <div className="truncate text-sm font-medium" title={currentBot.name}>
                    {currentBot.name}
                  </div>
                </div>
              </div>
            )}

            <div className="border-t p-3">
              <div className="flex items-center gap-1.5 rounded-xl px-2 py-1.5">
                <div aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold uppercase">
                  {user.name?.[0] ?? user.username[0]}
                </div>
                {/* IMP-FE22-23: блок имени/@username — кнопка, открывающая диалог «Профиль» */}
                <button
                  type="button"
                  onClick={onOpenProfile}
                  aria-label="Профиль"
                  className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="truncate text-sm font-medium">{user.name ?? user.username}</div>
                  <div className="truncate text-xs text-muted-foreground">@{user.username}</div>
                </button>
                {/* Тумблер темы — размер соседа (h-8 w-8), десктоп. В мобильный хедер
                    кнопка не добавляется (на 390px нет слота) — тема доступна из
                    «Ещё»-меню и палитры команд (IMP-FE21-02). */}
                <ThemeToggle className="h-8 w-8" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label="Выйти"
                      onClick={onLogout}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <LogOut className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Выйти из студии</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </aside>

          {/* IMP-FE22-19: цель skip-link; tabIndex=-1 — фокус после перехода по ссылке */}
          <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 min-h-0 flex flex-col outline-none">
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
