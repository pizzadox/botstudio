'use client';

import { useEffect, useState } from 'react';
import {
  Bot,
  Cable,
  Headset,
  Inbox,
  Loader2,
  MessagesSquare,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import { SOURCE_LABELS } from '@/lib/studio-types';
import type { BotListItem, Stats, ViewKey } from '@/lib/studio-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// Сетки-константы: скелетоны загрузки обязаны совпадать с реальными сетками контента
const STATS_GRID_CLASSES = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5';
const BOTS_GRID_CLASSES = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3';
const STATS_SKELETON_COUNT = 5;
const BOTS_SKELETON_COUNT = 3;

export default function Dashboard({
  onOpenBot,
  onBotsChanged,
}: {
  onOpenBot: (bot: BotListItem, view: ViewKey) => void;
  onBotsChanged: () => void;
}) {
  const { toast } = useToast();
  const [bots, setBots] = useState<BotListItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<BotListItem | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  // Подтверждение удаления (AlertDialog): state-target + open={!!target}
  const [deleteTarget, setDeleteTarget] = useState<BotListItem | null>(null);

  const load = async () => {
    try {
      const d = await api<{ bots: BotListItem[]; stats: Stats }>('/api/bots');
      setBots(d.bots);
      setStats(d.stats);
    } catch {
      toast({ title: 'Не удалось загрузить ботов', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // IMP-FE21-22: один запрос — POST /api/bots отдаёт { id, name }, поэтому бота
  // открываем сразу из локальных данных (optimistic), а список дашборда
  // обновится в фоне (botsVersion перемонтирует дашборд при возврате).
  const createBot = async () => {
    const botName = name.trim();
    if (!botName) return;
    setBusy(true);
    try {
      const d = await api<{ bot: { id: string; name: string } }>('/api/bots', {
        method: 'POST',
        body: JSON.stringify({ name: botName, description }),
      });
      setCreateOpen(false);
      setName('');
      setDescription('');
      toast({ title: 'Бот создан', description: 'Сценарий-шаблон уже готов к настройке' });
      onOpenBot(
        {
          id: d.bot.id,
          name: d.bot.name,
          description: description.trim() || null,
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          channelsCount: 0,
          conversationsCount: 0,
          channelTypes: [],
        },
        'editor'
      );
      onBotsChanged();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const deleteBot = async (bot: BotListItem) => {
    try {
      await api(`/api/bots/${bot.id}`, { method: 'DELETE' });
      toast({ title: 'Бот удалён' });
      onBotsChanged();
      load();
    } catch {
      toast({ title: 'Не удалось удалить бота', variant: 'destructive' });
    }
  };

  const renameBot = async () => {
    if (!renameTarget || !renameName.trim()) return;
    setRenameBusy(true);
    try {
      await api(`/api/bots/${renameTarget.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: renameName }),
      });
      setRenameTarget(null);
      onBotsChanged();
      load();
    } catch {
      toast({ title: 'Не удалось переименовать', variant: 'destructive' });
    } finally {
      setRenameBusy(false);
    }
  };

  const statCards = [
    { label: 'Ботов', value: stats?.bots ?? 0, icon: Bot, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400' },
    { label: 'Активных каналов', value: stats?.activeChannels ?? 0, icon: Cable, color: 'text-teal-600 bg-teal-100 dark:bg-teal-500/15 dark:text-teal-400' },
    { label: 'Диалогов', value: stats?.conversations ?? 0, icon: MessagesSquare, color: 'text-amber-600 bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400' },
    { label: 'Сообщений', value: stats?.messages ?? 0, icon: Inbox, color: 'text-violet-600 bg-violet-100 dark:bg-violet-500/15 dark:text-violet-400' },
    { label: 'Ждут оператора', value: stats?.needsOperator ?? 0, icon: Headset, color: 'text-rose-600 bg-rose-100 dark:bg-rose-500/15 dark:text-rose-400' },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight sm:text-2xl">Дашборд</h1>
          <p className="text-sm text-muted-foreground">
            Управляйте ботами и подключайте мессенджеры
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" /> Создать бота
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Новый бот</DialogTitle>
              <DialogDescription>
                Мы сразу создадим готовый сценарий-шаблон: приветствие, меню, ИИ-ответы и передачу оператору.
              </DialogDescription>
            </DialogHeader>
            {/* IMP-FE21-10: Enter отправляет форму, preventDefault обязателен */}
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                createBot();
              }}
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bot-name">Название</Label>
                  <Input
                    id="bot-name"
                    autoFocus
                    placeholder="Например: Поддержка интернет-магазина"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bot-desc">Описание</Label>
                  <Textarea
                    id="bot-desc"
                    placeholder="Для чего этот бот?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={busy || !name.trim()}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {busy ? 'Создаю…' : 'Создать'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Статистика */}
      {loading ? (
        <div className={STATS_GRID_CLASSES} role="status" aria-label="Загрузка статистики">
          {Array.from({ length: STATS_SKELETON_COUNT }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className={STATS_GRID_CLASSES}>
          {statCards.map((s) => (
            <Card key={s.label} className="p-4">
              <div className="flex items-center gap-3">
                <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', s.color)}>
                  <s.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-xl font-bold leading-tight tabular-nums">{s.value}</div>
                  <div className="truncate text-xs text-muted-foreground">{s.label}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Список ботов */}
      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Мои боты</h2>
        {loading ? (
          <div className={BOTS_GRID_CLASSES} role="status" aria-label="Загрузка ботов">
            {Array.from({ length: BOTS_SKELETON_COUNT }).map((_, i) => (
              <Skeleton key={i} className="h-[180px] rounded-xl" />
            ))}
          </div>
        ) : bots.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Bot className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="font-medium">Пока нет ни одного бота</div>
              <p className="max-w-sm text-sm text-muted-foreground">
                Создайте первого бота — и подключите его к Telegram, WhatsApp, MAX или сайту за пару минут.
              </p>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Создать первого бота
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className={BOTS_GRID_CLASSES}>
            {bots.map((bot) => (
              // IMP-FE21-19: контейнер больше не role="button" (внутри есть свои
              // кнопки — вложенность ломает скринридер). Тело осталось кликабельным,
              // а явная кнопка — имя бота в заголовке.
              <Card
                key={bot.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => onOpenBot(bot, 'editor')}
              >
                <CardHeader className="pb-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Bot className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">
                          <button
                            type="button"
                            aria-label={`Открыть бот «${bot.name}»`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenBot(bot, 'editor');
                            }}
                            className="w-full truncate rounded-sm text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            {bot.name}
                          </button>
                        </CardTitle>
                        <CardDescription className="truncate">
                          {bot.description || 'Без описания'}
                        </CardDescription>
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Меню бота">
                            <MoreVertical className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameTarget(bot);
                              setRenameName(bot.name);
                            }}
                          >
                            <Pencil className="h-4 w-4" /> Переименовать
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onSelect={() => setDeleteTarget(bot)}
                          >
                            <Trash2 className="h-4 w-4" /> Удалить
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={bot.status === 'published' ? 'default' : 'secondary'}>
                      {bot.status === 'published' ? 'Опубликован' : 'Черновик'}
                    </Badge>
                    {bot.channelTypes.length === 0 ? (
                      <Badge variant="outline">Нет каналов</Badge>
                    ) : (
                      bot.channelTypes.map((t) => (
                        <Badge key={t} variant="outline">
                          {SOURCE_LABELS[t] ?? t}
                        </Badge>
                      ))
                    )}
                    {bot.mytko && (
                      <Badge
                        variant="outline"
                        title={
                          bot.mytko.hasToken
                            ? 'Синхронизировано с MyTKO (Чистая логистика) — токен получен'
                            : 'Интеграция MyTKO включена, токен ещё не получен (раздел «Каналы»)'
                        }
                        className={
                          bot.mytko.hasToken
                            ? 'border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300'
                            : 'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300'
                        }
                      >
                        MyTKO {bot.mytko.hasToken ? '✓' : '…'}
                      </Badge>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="gap-2 border-t pt-3">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBot(bot, 'editor');
                    }}
                  >
                    <Workflow className="h-4 w-4" /> Конструктор
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Каналы: ${bot.channelsCount}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBot(bot, 'channels');
                    }}
                  >
                    <Cable className="h-4 w-4" aria-hidden="true" />{' '}
                    <span className="tabular-nums">{bot.channelsCount}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Диалоги: ${bot.conversationsCount}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBot(bot, 'inbox');
                    }}
                  >
                    <Inbox className="h-4 w-4" aria-hidden="true" />{' '}
                    <span className="tabular-nums">{bot.conversationsCount}</span>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Переименование */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Переименовать бота</DialogTitle>
          </DialogHeader>
          {/* IMP-FE21-10: Enter сохраняет */}
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              renameBot();
            }}
          >
            <Input
              autoFocus
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              aria-label="Новое имя бота"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
                Отмена
              </Button>
              <Button type="submit" disabled={renameBusy || !renameName.trim()}>
                {renameBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления бота — безвозвратно, вместе с диалогами/заявками */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить бота?</AlertDialogTitle>
            <AlertDialogDescription>
              Бот «{deleteTarget?.name}» и все его диалоги, заявки и каналы будут удалены
              безвозвратно. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60"
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (target) deleteBot(target);
              }}
            >
              Удалить безвозвратно
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
