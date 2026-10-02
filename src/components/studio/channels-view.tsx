'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Check,
  ChevronLeft,
  Copy,
  Database,
  Eye,
  EyeOff,
  Globe,
  Info,
  KeyRound,
  Loader2,
  MessageCircle,
  MessageSquare,
  Plug,
  Plus,
  Send,
  Trash2,
  Truck,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import type { ChannelItem } from '@/lib/studio-types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
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
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const CHANNEL_META: Record<
  ChannelItem['type'],
  { label: string; icon: typeof Send; color: string; hint: string; tokenLabel: string }
> = {
  telegram: {
    label: 'Telegram',
    icon: Send,
    color: 'bg-sky-100 text-sky-600',
    hint: '1. Откройте @BotFather → /newbot\n2. Скопируйте токен и вставьте здесь\n3. Скопируйте URL вебхука ниже — BotFather сам предложит его установить (или отправьте setWebhook вручную)',
    tokenLabel: 'Bot token (123456:ABC-DEF…)',
  },
  whatsapp: {
    label: 'WhatsApp',
    icon: MessageCircle,
    color: 'bg-emerald-100 text-emerald-600',
    hint: 'Подключение через WhatsApp Cloud API (Meta for Developers):\n1. Создайте приложение и добавьте продукт WhatsApp\n2. Вставьте Permanent Token в поле токена\n3. Укажите Phone Number ID в поле ниже\n4. Скопируйте URL вебхука в настройки WhatsApp → Callback URL',
    tokenLabel: 'Access Token (Meta)',
  },
  max: {
    label: 'MAX',
    icon: MessageSquare,
    color: 'bg-violet-100 text-violet-600',
    hint: 'Как получить токен:\n1. Откройте мессенджер MAX и найдите бота «MAX для бизнеса» (или откройте max.ru → Чат-боты)\n2. Создайте бота и скопируйте токен: раздел Чат-боты → выберите бота → ⋮ → Настройки → значок копирования\n3. Вставьте токен здесь и нажмите «Подключить»\n\nВебхук настраивать не нужно — студия сама принимает и отправляет сообщения в MAX.',
    tokenLabel: 'Bot token MAX',
  },
  web: {
    label: 'Чат для сайта',
    icon: Globe,
    color: 'bg-amber-100 text-amber-600',
    hint: 'Демо-чат не требует токенов. Скопируйте URL и обращайтесь к нему с сайта — или протестируйте бота прямо здесь, как это увидят посетители.',
    tokenLabel: 'Токен не требуется',
  },
};

export default function ChannelsView({
  bot,
  onBack,
  onOpenEditor,
}: {
  bot: { id: string; name: string; status: string };
  onBack: () => void;
  onOpenEditor: () => void;
}) {
  const { toast } = useToast();
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [type, setType] = useState<ChannelItem['type']>('telegram');
  const [title, setTitle] = useState('');
  const [token, setToken] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoChannel, setDemoChannel] = useState<ChannelItem | null>(null);
  const [origin, setOrigin] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api<{ channels: ChannelItem[] }>(`/api/bots/${bot.id}/channels`);
      setChannels(d.channels);
    } catch {
      toast({ title: 'Не удалось загрузить каналы', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [bot.id, toast]);

  useEffect(() => {
    setOrigin(window.location.origin);
    load();
  }, [load]);

  const createChannel = async () => {
    setBusy(true);
    try {
      await api(`/api/bots/${bot.id}/channels`, {
        method: 'POST',
        body: JSON.stringify({ type, title, token, phone }),
      });
      setAddOpen(false);
      setTitle('');
      setToken('');
      setPhone('');
      toast({ title: 'Канал добавлен' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (ch: ChannelItem, active: boolean) => {
    setChannels((cs) => cs.map((c) => (c.id === ch.id ? { ...c, active } : c)));
    try {
      await api(`/api/channels/${ch.id}`, { method: 'PUT', body: JSON.stringify({ active }) });
    } catch {
      load();
    }
  };

  const testChannel = async (ch: ChannelItem) => {
    toast({ title: 'Проверяем подключение…' });
    try {
      const d = await api<{ ok: boolean; message: string }>(`/api/channels/${ch.id}/test`, {
        method: 'POST',
      });
      toast({ title: d.message, variant: d.ok ? 'default' : 'destructive' });
      load();
    } catch {
      toast({ title: 'Ошибка проверки', variant: 'destructive' });
    }
  };

  const deleteChannel = async (ch: ChannelItem) => {
    try {
      await api(`/api/channels/${ch.id}`, { method: 'DELETE' });
      toast({ title: 'Канал удалён' });
      load();
    } catch {
      toast({ title: 'Не удалось удалить', variant: 'destructive' });
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Скопировано в буфер' });
    } catch {
      toast({ title: 'Не удалось скопировать', variant: 'destructive' });
    }
  };

  const webhookUrl = (ch: ChannelItem) => `${origin}/api/webhook/${ch.type}/${ch.secret}`;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label="Назад">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Plug className="h-6 w-6 text-primary" /> Каналы
            </h1>
            <p className="text-sm text-muted-foreground">Подключение бота «{bot.name}» к мессенджерам</p>
          </div>
        </div>
        <Button onClick={() => { setType('telegram'); setAddOpen(true); }}>
          <Plus className="h-4 w-4" /> Подключить канал
        </Button>
      </div>

      {bot.status !== 'published' && (
        <Alert className="border-amber-200 bg-amber-50">
          <Info className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800">Бот ещё не опубликован</AlertTitle>
          <AlertDescription className="text-amber-700">
            Каналы сохранят настройки, но отвечать они начнут после публикации бота в{' '}
            <button className="font-medium underline underline-offset-2" onClick={onOpenEditor}>
              конструкторе
            </button>
            .
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Загрузка…
        </div>
      ) : channels.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Plug className="h-7 w-7" />
            </div>
            <div className="font-medium">Ни один канал не подключён</div>
            <p className="max-w-md text-sm text-muted-foreground">
              Подключите Telegram, WhatsApp, MAX — или создайте демо-чат, чтобы общаться с ботом
              прямо на сайте.
            </p>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Подключить канал
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((ch) => {
            const meta = CHANNEL_META[ch.type];
            const Icon = meta.icon;
            return (
              <Card key={ch.id}>
                <CardHeader className="pb-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', meta.color)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{ch.title}</CardTitle>
                        <CardDescription>{meta.label}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={ch.active}
                        onCheckedChange={(v) => toggleActive(ch, v)}
                        aria-label="Включить канал"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ch.type === 'max' ? (
                    <div className="rounded-lg border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">Вебхук не нужен.</span> Сообщения из MAX
                      принимаются автоматически (long polling). Нажмите «Проверить» — студия свяжется с MAX и
                      покажет имя бота.
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
                      <code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                        {webhookUrl(ch)}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => copy(webhookUrl(ch))}
                        aria-label="Скопировать URL вебхука"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  {ch.type === 'web' && (
                    <Button variant="outline" className="w-full" onClick={() => setDemoChannel(ch)}>
                      <Bot className="h-4 w-4" /> Открыть демо-чат
                    </Button>
                  )}
                  {ch.lastStatus && (
                    <p className="text-xs text-muted-foreground">Статус: {ch.lastStatus}</p>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => testChannel(ch)}>
                      <Zap className="h-3.5 w-3.5" /> Проверить
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => deleteChannel(ch)}
                      aria-label="Удалить канал"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <details className="group">
                    <summary className="cursor-pointer text-xs font-medium text-primary">
                      Как подключить
                    </summary>
                    <p className="mt-2 whitespace-pre-line rounded-lg border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      {meta.hint}
                    </p>
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Интеграция MyTKO (mytko.ru — «Чистая логистика») */}
      <MytkoCard botId={bot.id} />

      {/* Диалог добавления канала */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подключить канал</DialogTitle>
            <DialogDescription>
              Выберите мессенджер и вставьте данные доступа.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(CHANNEL_META) as ChannelItem['type'][]).map((t) => {
                const meta = CHANNEL_META[t];
                const Icon = meta.icon;
                return (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-all',
                      type === t
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'hover:border-primary/40'
                    )}
                  >
                    <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', meta.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    {meta.label}
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ch-title">Название канала</Label>
              <Input
                id="ch-title"
                placeholder={`${CHANNEL_META[type].label} — основной`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            {type !== 'web' && (
              <div className="space-y-2">
                <Label htmlFor="ch-token">{CHANNEL_META[type].tokenLabel}</Label>
                <Input
                  id="ch-token"
                  type="password"
                  placeholder="вставьте токен"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
            )}
            {type === 'whatsapp' && (
              <div className="space-y-2">
                <Label htmlFor="ch-phone">Phone Number ID</Label>
                <Input
                  id="ch-phone"
                  placeholder="например 123456789012345"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            )}
            <p className="whitespace-pre-line rounded-lg border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              {CHANNEL_META[type].hint}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Отмена
            </Button>
            <Button onClick={createChannel} disabled={busy || (type !== 'web' && !token.trim())}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Подключить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Демо-чат */}
      <Dialog open={!!demoChannel} onOpenChange={(o) => !o && setDemoChannel(null)}>
        <DialogContent className="gap-0 p-0 sm:max-w-md">
          <VisuallyHidden>
            <DialogTitle>Демо-чат</DialogTitle>
            <DialogDescription>
              Проверьте, как бот общается с посетителями сайта
            </DialogDescription>
          </VisuallyHidden>
          {demoChannel && <DemoChat secret={demoChannel.secret} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Демо-виджет чата ────────────────────────────────────────────────────────

function DemoChat({ secret }: { secret: string }) {
  const [messages, setMessages] = useState<
    { id: string; role: string; text: string; buttons?: { id: string; text: string }[] }[]
  >([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const convRef = useRef<string | null>(null);
  const visitorRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const storageKey = `botstudio_demo_conv_${secret}`;
  const visitorKey = 'botstudio_visitor';

  // Стабильный id посетителя: один гость = одно обращение,
  // даже если conversationId был потерян
  useEffect(() => {
    try {
      let v = window.localStorage.getItem(visitorKey);
      if (!v) {
        v =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID().replace(/-/g, '')
            : Math.random().toString(36).slice(2) + Date.now().toString(36);
        window.localStorage.setItem(visitorKey, v);
      }
      visitorRef.current = v;
    } catch {
      visitorRef.current = Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }, [visitorKey]);

  // Восстановить диалог посетителя (как реальный виджет сайта)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        convRef.current = saved;
        fetch(`/api/webhook/demo/${secret}?conversationId=${saved}`)
          .then((r) => r.json())
          .then((d) => {
            if (d.messages?.length) setMessages(d.messages);
          })
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, [secret, storageKey]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const poll = useCallback(async () => {
    if (!convRef.current) return;
    try {
      const d = await api<{
        messages: { id: string; role: string; text: string; buttons?: { id: string; text: string }[] }[];
      }>(`/api/webhook/demo/${secret}?conversationId=${convRef.current}`);
      setMessages((prev) => (d.messages.length > prev.length ? d.messages : prev));
    } catch {
      /* ignore */
    }
  }, [secret]);

  useEffect(() => {
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
  }, [poll]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setInput('');
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', text: t }]);
    scrollToBottom();
    try {
      const d = await api<{
        conversationId: string;
        messages: { id: string; role: string; text: string; buttons?: { id: string; text: string }[] }[];
      }>(`/api/webhook/demo/${secret}`, {
        method: 'POST',
        body: JSON.stringify({ text: t, conversationId: convRef.current, visitorId: visitorRef.current || undefined }),
      });
      convRef.current = d.conversationId;
      try {
        window.localStorage.setItem(storageKey, d.conversationId);
      } catch {
        /* ignore */
      }
      setMessages(d.messages);
      scrollToBottom();
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'bot', text: e instanceof Error ? e.message : 'Ошибка' },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 rounded-t-xl bg-gradient-to-r from-emerald-600 to-teal-600 p-4 text-white">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
          <Bot className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold leading-tight">Чат поддержки</div>
          <div className="flex items-center gap-1 text-xs text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> онлайн
          </div>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          демо сайта
        </Badge>
      </div>
      <div ref={scrollRef} className="h-80 space-y-2.5 overflow-y-auto bg-muted/40 p-3">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            Напишите сообщение — бот ответит
            <br />
            как в настоящем виджете на сайте
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-snug',
                m.role === 'user'
                  ? 'rounded-br-md bg-primary text-primary-foreground'
                  : 'rounded-bl-md border bg-card'
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
        {(() => {
          const lastButtons = [...messages].reverse().find((m) => m.role === 'bot' && m.buttons?.length)?.buttons;
          if (!lastButtons?.length) return null;
          return (
            <div className="flex flex-wrap gap-2 pt-1">
              {lastButtons.map((b) => (
                <button
                  key={b.id}
                  onClick={() => send(b.text)}
                  disabled={sending}
                  className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
                >
                  {b.text}
                </button>
              ))}
            </div>
          );
        })()}
      </div>
      <form
        className="flex items-center gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Input placeholder="Сообщение…" value={input} onChange={(e) => setInput(e.target.value)} />
        <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={sending || !input.trim()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}

// ─── Интеграция MyTKO (mytko.ru «Чистая логистика») ──────────────────────────

interface MytkoReportItem {
  id: string;
  removalTs: string | null;
  vehicleNumber: string | null;
  lkCode: string | null;
  factContainersAmount: number | null;
  pickedUpVolume: number | null;
  notRemoved: number;
}

interface MytkoDirectionsUi {
  areas: boolean;
  driverReports: boolean;
  requests: boolean;
  sendRequests: boolean;
}

const MYTKO_DIRECTION_ITEMS: Array<{
  key: keyof MytkoDirectionsUi;
  dir: 'in' | 'out';
  label: string;
  hint: string;
}> = [
  {
    key: 'areas',
    dir: 'in',
    label: 'Реестр КП',
    hint: 'Все контейнерные площадки проекта: коды, адреса, координаты',
  },
  {
    key: 'driverReports',
    dir: 'in',
    label: 'Отчёты водителей',
    hint: 'Факты вывоза по КП: машина, дата, объём',
  },
  {
    key: 'requests',
    dir: 'in',
    label: 'Заявки на вывоз',
    hint: 'Чтение заявок из MyTKO',
  },
  {
    key: 'sendRequests',
    dir: 'out',
    label: 'Заявки на вывоз',
    hint: 'Передача заявок из чат-бота в MyTKO (через Kafka, доступ выдаёт ТП MyTKO)',
  },
];

function MytkoCard({ botId }: { botId: string }) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState({
    enabled: false,
    apiUrl: '',
    username: '',
    lkCodes: '',
    useAllAreas: false,
    directions: {
      areas: true,
      driverReports: true,
      requests: false,
      sendRequests: false,
    } as MytkoDirectionsUi,
    hasPassword: false,
    tokenMasked: null as string | null,
    tokenIssuedAt: null as string | null,
    areasSyncedAt: null as string | null,
    areasCount: 0,
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'login' | 'test' | 'reports' | 'save' | 'areas' | null>(null);
  const [reports, setReports] = useState<MytkoReportItem[] | null>(null);
  const [connectionName, setConnectionName] = useState<string | null>(null);

  useEffect(() => {
    api<{ config: typeof cfg }>(`/api/bots/${botId}/mytko`)
      .then((d) => setCfg(d.config))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [botId]);

  const save = async (patch?: Record<string, unknown>) => {
    try {
      await api(`/api/bots/${botId}/mytko`, {
        method: 'POST',
        body: JSON.stringify({ action: 'save', ...patch }),
      });
      return true;
    } catch {
      toast({ title: 'Не удалось сохранить настройки', variant: 'destructive' });
      return false;
    }
  };

  /** Вход по логину/паролю: получаем Bearer-токен у MyTKO и сохраняем в настройках */
  const login = async () => {
    setBusy('login');
    try {
      const d = await api<{ ok: boolean; tokenMasked?: string; tokenIssuedAt?: string; error?: string }>(
        `/api/bots/${botId}/mytko`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'login',
            apiUrl: cfg.apiUrl,
            username: cfg.username,
            // Введённый пароль уходит прямо в запрос — ничего не теряется
            ...(password.trim() ? { password: password.trim() } : {}),
          }),
        }
      );
      if (d.ok) {
        setCfg((c) => ({
          ...c,
          tokenMasked: d.tokenMasked ?? null,
          tokenIssuedAt: d.tokenIssuedAt ?? null,
          hasPassword: true,
        }));
        setPassword('');
        toast({ title: 'Токен MyTKO получен ✅', description: 'Сохранён в настройках интеграции' });
      } else {
        toast({ title: 'Не удалось получить токен', description: d.error ?? 'unknown', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Ошибка входа', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const d = await api<{ ok: boolean; name?: string; regions?: string[]; error?: string }>(
        `/api/bots/${botId}/mytko`,
        { method: 'POST', body: JSON.stringify({ action: 'test' }) }
      );
      if (d.ok) {
        setConnectionName(d.name ?? null);
        toast({
          title: 'Подключение к MyTKO установлено ✅',
          description: d.name ? `${d.name}${d.regions?.length ? ` · ${d.regions.length} рег.` : ''}` : undefined,
        });
      } else {
        setConnectionName(null);
        toast({ title: `Ошибка: ${d.error ?? 'unknown'}`, variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Ошибка проверки', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  /** Загрузить реестр всех КП проекта («все возможные КОДЫ КП») */
  const syncAreas = async () => {
    setBusy('areas');
    try {
      const d = await api<{ ok: boolean; count?: number; error?: string }>(`/api/bots/${botId}/mytko`, {
        method: 'POST',
        body: JSON.stringify({ action: 'sync-areas' }),
      });
      if (d.ok) {
        setCfg((c) => ({
          ...c,
          areasCount: d.count ?? c.areasCount,
          useAllAreas: true,
          areasSyncedAt: new Date().toISOString(),
        }));
        toast({
          title: `Реестр КП загружен: ${d.count ?? 0} площадок`,
          description: 'В сверке используются все возможные КОДЫ КП',
        });
      } else {
        toast({ title: `Ошибка: ${d.error ?? 'unknown'}`, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Не удалось загрузить реестр КП', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const loadReports = async () => {
    setBusy('reports');
    try {
      const d = await api<{ ok: boolean; reports?: MytkoReportItem[]; areaCodes?: number; error?: string }>(
        `/api/bots/${botId}/mytko`,
        { method: 'POST', body: JSON.stringify({ action: 'reports' }) }
      );
      if (d.ok && d.reports) {
        setReports(d.reports);
        toast({
          title: `Загружено отчётов: ${d.reports.length}`,
          description: d.areaCodes ? `Проверено КП: ${d.areaCodes}` : undefined,
        });
      } else {
        toast({ title: `Ошибка: ${d.error ?? 'unknown'}`, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Не удалось загрузить отчёты', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (!loaded) return null;

  const toggleDirection = (key: keyof MytkoDirectionsUi) => {
    const next = { ...cfg.directions, [key]: !cfg.directions[key] };
    setCfg((c) => ({ ...c, directions: next }));
    save({ directions: next });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Truck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                Интеграция MyTKO
                {cfg.tokenMasked ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-800"
                    title={`Токен получен: ${cfg.tokenMasked}`}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" /> синхронизировано
                  </span>
                ) : (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800"
                    title="Токен ещё не получен — введите логин и пароль и нажмите «Войти и получить токен»"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" /> нет токена
                  </span>
                )}
              </CardTitle>
              <CardDescription className="truncate">
                «Чистая логистика»: токен по логину/паролю, реестр КП и факты вывоза
              </CardDescription>
            </div>
          </div>
          <Switch
            checked={cfg.enabled}
            onCheckedChange={(v) => {
              setCfg((c) => ({ ...c, enabled: v }));
              save({ enabled: v });
            }}
            aria-label="Включить интеграцию MyTKO"
          />
        </div>
      </CardHeader>
      {cfg.enabled && (
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Адрес API вашего проекта</Label>
              <Input
                value={cfg.apiUrl}
                placeholder="ecovn.mytko.ru"
                onChange={(e) => setCfg((c) => ({ ...c, apiUrl: e.target.value }))}
                onBlur={() => save({ apiUrl: cfg.apiUrl })}
              />
              <p className="text-[10px] leading-snug text-muted-foreground">
                У каждого города/проекта свой адрес (у вас — <b>ecovn.mytko.ru</b>), пути API одинаковые.
                Можно с https:// или без — студия нормализует.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Логин</Label>
              <Input
                value={cfg.username}
                placeholder="логин от приложения MyTKO"
                onChange={(e) => setCfg((c) => ({ ...c, username: e.target.value }))}
                onBlur={() => save({ username: cfg.username })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Пароль{' '}
                {cfg.hasPassword ? (
                  <span className="text-emerald-600">••• сохранён</span>
                ) : (
                  <span className="text-amber-600">не задан</span>
                )}
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  placeholder={cfg.hasPassword ? 'введён — введите новый, чтобы заменить' : 'пароль MyTKO'}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => {
                    // Сохраняем сразу при уходе с поля, но НЕ стираем введённое:
                    // кнопка «Войти» также отправит пароль напрямую
                    if (password.trim()) {
                      save({ password: password.trim() });
                      setCfg((c) => ({ ...c, hasPassword: true }));
                    }
                  }}
                  className="pr-9"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[10px] leading-snug text-muted-foreground">
                Пароль хранится только в настройках бота и нужен, чтобы получать токен MyTKO автоматически.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Коды КП вручную (через запятую)</Label>
              <Input
                value={cfg.lkCodes}
                placeholder="38012345, 38105858"
                disabled={cfg.useAllAreas}
                onChange={(e) => setCfg((c) => ({ ...c, lkCodes: e.target.value }))}
                onBlur={() => save({ lkCodes: cfg.lkCodes })}
              />
              {cfg.useAllAreas && (
                <p className="text-[10px] leading-snug text-emerald-700">
                  Используются все возможные КП из реестра MyTKO ({cfg.areasCount} шт.) — ручной список не нужен.
                </p>
              )}
            </div>
          </div>

          {/* Токен: получение по логину/паролю и статус */}
          <div className="space-y-1 rounded-lg border bg-muted/30 p-2.5">
            <Label className="text-xs text-muted-foreground">
              Bearer-токен
              {cfg.tokenIssuedAt && (
                <span className="font-normal">
                  {' '}· получен{' '}
                  {new Date(cfg.tokenIssuedAt).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                readOnly
                value={cfg.tokenMasked ?? ''}
                placeholder="ещё не получен — войдите по логину и паролю"
                className="min-w-0 flex-1 font-mono text-xs"
              />
              <Button
                size="sm"
                onClick={login}
                disabled={busy !== null || !cfg.username.trim() || (!cfg.hasPassword && !password.trim())}
                className="shrink-0"
              >
                {busy === 'login' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <KeyRound className="h-3.5 w-3.5" />
                )}
                Войти и получить токен
              </Button>
            </div>
          </div>

          {/* Обмен данными: что получаем и что отправляем */}
          <div className="rounded-lg border p-3">
            <Label className="text-xs font-medium">Обмен данными с MyTKO</Label>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Отметьте, какие данные получаем из MyTKO и какие отправляем туда
            </p>
            <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <ArrowDownToLine className="h-3 w-3" /> Получаем из MyTKO
                </p>
                <div className="space-y-1.5">
                  {MYTKO_DIRECTION_ITEMS.filter((d) => d.dir === 'in').map((d) => (
                    <label
                      key={d.key}
                      className="flex cursor-pointer items-start gap-2 rounded-md p-1 transition-colors hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={cfg.directions[d.key]}
                        onCheckedChange={() => toggleDirection(d.key)}
                        className="mt-0.5"
                        aria-label={`Получать: ${d.label}`}
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium leading-tight">{d.label}</span>
                        <span className="block text-[10px] leading-snug text-muted-foreground">{d.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <ArrowUpFromLine className="h-3 w-3" /> Отправляем в MyTKO
                </p>
                <div className="space-y-1.5">
                  {MYTKO_DIRECTION_ITEMS.filter((d) => d.dir === 'out').map((d) => (
                    <label
                      key={d.key}
                      className="flex cursor-pointer items-start gap-2 rounded-md p-1 transition-colors hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={cfg.directions[d.key]}
                        onCheckedChange={() => toggleDirection(d.key)}
                        className="mt-0.5"
                        aria-label={`Отправлять: ${d.label}`}
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium leading-tight">{d.label}</span>
                        <span className="block text-[10px] leading-snug text-muted-foreground">{d.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* КОДЫ КП: все возможные из реестра MyTKO */}
          <div className="rounded-lg border p-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-tight">Все возможные КОДЫ КП</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {cfg.areasCount > 0 ? (
                      <>
                        В реестре: <b>{cfg.areasCount.toLocaleString('ru-RU')} КП</b>
                        {cfg.areasSyncedAt &&
                          ` · обновлено ${new Date(cfg.areasSyncedAt).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}`}
                      </>
                    ) : (
                      'Реестр ещё не загружен — нажмите «Загрузить все КП»'
                    )}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={cfg.useAllAreas}
                  onCheckedChange={(v) => {
                    setCfg((c) => ({ ...c, useAllAreas: v }));
                    save({ useAllAreas: v });
                  }}
                  disabled={cfg.areasCount === 0}
                  aria-label="Использовать все возможные КП"
                />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={syncAreas} disabled={busy !== null}>
                {busy === 'areas' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Database className="h-3.5 w-3.5" />
                )}
                {cfg.areasCount > 0 ? 'Обновить реестр КП' : 'Загрузить все КП из MyTKO'}
              </Button>
              <span className="text-[10px] leading-snug text-muted-foreground">
                Загружает весь справочник контейнерных площадок проекта (может занять ~минуту)
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={test} disabled={busy !== null}>
              {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Проверить подключение
            </Button>
            <Button size="sm" variant="outline" onClick={loadReports} disabled={busy !== null}>
              {busy === 'reports' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Truck className="h-3.5 w-3.5" />
              )}
              Отчёты водителей
            </Button>
            {connectionName && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-800">
                <Check className="h-3 w-3" /> {connectionName}
              </span>
            )}
          </div>
          {reports && (
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              {reports.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">
                  Отчётов за последние 7 дней по указанным КП нет.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/70 text-left text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Дата вывоза</th>
                      <th className="px-2 py-1.5 font-medium">КП</th>
                      <th className="px-2 py-1.5 font-medium">Машина</th>
                      <th className="px-2 py-1.5 font-medium">Факт</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="whitespace-nowrap px-2 py-1.5">
                          {r.removalTs
                            ? new Date(r.removalTs).toLocaleString('ru-RU', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td className="px-2 py-1.5">{r.lkCode ?? '—'}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-medium">{r.vehicleNumber ?? '—'}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          {r.factContainersAmount ?? '—'}
                          {r.notRemoved > 0 && (
                            <span className="ml-1 text-destructive">(-{r.notRemoved})</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-xs font-medium text-primary">Как работает интеграция</summary>
            <p className="mt-2 rounded-lg border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              Введите адрес API (у вас — <b>ecovn.mytko.ru</b>), логин и пароль от приложения MyTKO — студия
              получит Bearer-токен (POST /app/api/v1/authenticate) и сохранит его; при протухании токен
              обновится автоматически. Данные читаются через GraphQL (/app/graphql): реестр КП
              (containerAreas — все возможные КОДЫ КП), отчёты водителей
              (reportsFromDriverByAreaCodesAndPeriod), заявки. Синхронизация заявок — кнопкой
              «Синхронизировать с MyTKO» в карточке заявки; полная передача REMOVAL_REQUEST идёт через
              Kafka (доступ выдаёт техподдержка mytko@groupstp.ru).
            </p>
          </details>
        </CardContent>
      )}
    </Card>
  );
}
