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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

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

  const createBot = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const d = await api<{ bot: { id: string } }>('/api/bots', {
        method: 'POST',
        body: JSON.stringify({ name, description }),
      });
      setCreateOpen(false);
      setName('');
      setDescription('');
      toast({ title: 'Бот создан', description: 'Сценарий-шаблон уже готов к настройке' });
      onBotsChanged();
      await load();
      const created = await api<{ bots: BotListItem[] }>('/api/bots');
      const bot = created.bots.find((b) => b.id === d.bot.id);
      if (bot) onOpenBot(bot, 'editor');
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
    }
  };

  const statCards = [
    { label: 'Ботов', value: stats?.bots ?? 0, icon: Bot, color: 'text-emerald-600 bg-emerald-100' },
    { label: 'Активных каналов', value: stats?.activeChannels ?? 0, icon: Cable, color: 'text-teal-600 bg-teal-100' },
    { label: 'Диалогов', value: stats?.conversations ?? 0, icon: MessagesSquare, color: 'text-amber-600 bg-amber-100' },
    { label: 'Сообщений', value: stats?.messages ?? 0, icon: Inbox, color: 'text-violet-600 bg-violet-100' },
    { label: 'Ждут оператора', value: stats?.needsOperator ?? 0, icon: Headset, color: 'text-rose-600 bg-rose-100' },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Дашборд</h1>
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
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bot-name">Название</Label>
                <Input
                  id="bot-name"
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
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Отмена
              </Button>
              <Button onClick={createBot} disabled={busy || !name.trim()}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Создать
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center gap-3">
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', s.color)}>
                <s.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xl font-bold leading-tight">{s.value}</div>
                <div className="truncate text-xs text-muted-foreground">{s.label}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Список ботов */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Мои боты</h2>
        {loading ? (
          <div className="flex items-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Загрузка…
          </div>
        ) : bots.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Bot className="h-7 w-7" />
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {bots.map((bot) => (
              <Card
                key={bot.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => onOpenBot(bot, 'editor')}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Bot className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{bot.name}</CardTitle>
                        <CardDescription className="truncate">
                          {bot.description || 'Без описания'}
                        </CardDescription>
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
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
                          <DropdownMenuItem className="text-destructive" onClick={() => deleteBot(bot)}>
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
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBot(bot, 'channels');
                    }}
                  >
                    <Cable className="h-4 w-4" /> {bot.channelsCount}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBot(bot, 'inbox');
                    }}
                  >
                    <Inbox className="h-4 w-4" /> {bot.conversationsCount}
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
          <Input value={renameName} onChange={(e) => setRenameName(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Отмена
            </Button>
            <Button onClick={renameBot}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
