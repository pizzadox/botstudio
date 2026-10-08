'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Bot,
  BrainCircuit,
  ChevronLeft,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import type { AiConfig, KnowledgeItemDto } from '@/lib/studio-types';
import type { EngineState } from '@/lib/flow-types';
import { Badge } from '@/components/ui/badge';
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
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const DEFAULT_PROMPT =
  'Ты — дружелюбный ИИ-ассистент техподдержки. Отвечай кратко, вежливо и по делу, на языке пользователя. Опирайся на базу знаний; если ответа нет — честно скажи об этом и предложи позвать оператора.';

interface ChatItem {
  id: string;
  role: 'user' | 'bot';
  text: string;
  buttons?: { id: string; text: string }[];
}

export default function AiAssistantView({
  bot,
  onBack,
  onOpenInbox,
}: {
  bot: { id: string; name: string; status: string };
  onBack: () => void;
  onOpenInbox: () => void;
}) {
  const { toast } = useToast();

  // ── Настройки ассистента ──
  const [cfg, setCfg] = useState<AiConfig>({ enabled: false, prompt: '', reaskMenu: true });
  const [savedCfg, setSavedCfg] = useState<AiConfig>({ enabled: false, prompt: '', reaskMenu: true });
  const [loaded, setLoaded] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);

  // ── База знаний ──
  const [knowledge, setKnowledge] = useState<KnowledgeItemDto[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; title: string; content: string } | null>(null);
  const [kbBusy, setKbBusy] = useState(false);
  // Подтверждение удаления (AlertDialog): state-target + open={!!target}
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeItemDto | null>(null);

  // ── Тест-чат ──
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [chatState, setChatState] = useState<EngineState | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [handedOff, setHandedOff] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dirty = JSON.stringify(cfg) !== JSON.stringify(savedCfg);

  const load = useCallback(async () => {
    try {
      const d = await api<{ aiConfig: AiConfig; knowledge: KnowledgeItemDto[] }>(
        `/api/bots/${bot.id}/ai`
      );
      const c: AiConfig = {
        enabled: d.aiConfig.enabled === true,
        prompt: d.aiConfig.prompt ?? '',
        reaskMenu: d.aiConfig.reaskMenu !== false,
      };
      setCfg(c);
      setSavedCfg(c);
      setKnowledge(d.knowledge);
    } catch {
      toast({ title: 'Не удалось загрузить настройки ассистента', variant: 'destructive' });
    } finally {
      setLoaded(true);
    }
  }, [bot.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat, sending]);

  const saveCfg = async () => {
    setSavingCfg(true);
    try {
      const d = await api<{ aiConfig: AiConfig }>(`/api/bots/${bot.id}/ai`, {
        method: 'PUT',
        body: JSON.stringify(cfg),
      });
      const c: AiConfig = {
        enabled: d.aiConfig.enabled === true,
        prompt: d.aiConfig.prompt ?? '',
        reaskMenu: d.aiConfig.reaskMenu !== false,
      };
      setSavedCfg(c);
      setCfg(c);
      toast({
        title: c.enabled ? 'ИИ-ассистент включён' : 'Настройки сохранены',
        description: c.enabled
          ? 'Бот отвечает на свободные вопросы во всех каналах.'
          : 'Ассистент работает только по сценарию.',
      });
    } catch {
      toast({ title: 'Ошибка сохранения', variant: 'destructive' });
    } finally {
      setSavingCfg(false);
    }
  };

  // ── База знаний: CRUD ──
  const saveItem = async () => {
    if (!editing) return;
    if (!editing.title.trim() || !editing.content.trim()) {
      toast({ title: 'Укажите заголовок и содержимое', variant: 'destructive' });
      return;
    }
    setKbBusy(true);
    try {
      if (editing.id) {
        const d = await api<{ item: KnowledgeItemDto }>(`/api/knowledge/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ title: editing.title, content: editing.content }),
        });
        setKnowledge((prev) => prev.map((k) => (k.id === d.item.id ? d.item : k)));
      } else {
        const d = await api<{ item: KnowledgeItemDto }>(`/api/bots/${bot.id}/knowledge`, {
          method: 'POST',
          body: JSON.stringify({ title: editing.title, content: editing.content }),
        });
        setKnowledge((prev) => [...prev, d.item]);
      }
      setEditing(null);
    } catch {
      toast({ title: 'Не удалось сохранить запись', variant: 'destructive' });
    } finally {
      setKbBusy(false);
    }
  };

  const deleteItem = async (id: string) => {
    setKbBusy(true);
    try {
      await api(`/api/knowledge/${id}`, { method: 'DELETE' });
      setKnowledge((prev) => prev.filter((k) => k.id !== id));
      if (editing?.id === id) setEditing(null);
    } catch {
      toast({ title: 'Не удалось удалить запись', variant: 'destructive' });
    } finally {
      setKbBusy(false);
    }
  };

  // ── Тест-чат ──
  const send = async (text: string) => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setInput('');
    setChat((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: t }]);
    try {
      const d = await api<{
        messages: { text: string; nodeId: string; buttons?: { id: string; text: string }[] }[];
        state: EngineState;
        needsOperator: boolean;
        conversationId?: string;
      }>(`/api/bots/${bot.id}/simulate`, {
        method: 'POST',
        body: JSON.stringify({ input: t, state: chatState, conversationId: handedOff ?? undefined }),
      });
      setChatState(d.state);
      setChat((prev) => [
        ...prev,
        ...d.messages.map((m, i) => ({
          id: `b-${Date.now()}-${i}`,
          role: 'bot' as const,
          text: m.text,
          buttons: m.buttons,
        })),
      ]);
      if (d.needsOperator) setHandedOff(d.conversationId ?? 'operator');
    } catch {
      setChat((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'bot', text: 'Ошибка: не удалось получить ответ. Попробуйте ещё раз.' },
      ]);
    } finally {
      setSending(false);
    }
  };

  const resetChat = () => {
    setChat([]);
    setChatState(null);
    setHandedOff(null);
    setInput('');
  };

  const kbSuggestions = knowledge.slice(0, 3).map((k) => k.title);

  if (!loaded) {
    return (
      <div
        className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6 lg:p-8"
        role="status"
        aria-label="Загрузка настроек ассистента"
      >
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
        </div>
        <div className="grid gap-6 xl:grid-cols-5">
          <div className="space-y-6 xl:col-span-3">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
          <Skeleton className="h-[480px] rounded-xl xl:col-span-2" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6 lg:p-8">
      {/* Заголовок */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label="Назад">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
              <Sparkles className="h-6 w-6 shrink-0 text-primary" aria-hidden /> ИИ-ассистент
            </h1>
            <p className="truncate text-sm text-muted-foreground">
              Нейросеть отвечает на свободные вопросы клиентов бота «{bot.name}»
            </p>
          </div>
        </div>
        {bot.status !== 'published' && (
          <Badge
            variant="outline"
            className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
          >
            Бот не опубликован — ассистент работает только в тестах
          </Badge>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        {/* Левая колонка: настройки + база знаний */}
        <div className="space-y-6 xl:col-span-3">
          {/* Настройки */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <BrainCircuit className="h-5 w-5 shrink-0 text-primary" aria-hidden /> Настройки ассистента
              </CardTitle>
              <CardDescription>
                Когда сценарию нечего ответить (свободный текст вместо кнопки, вопрос вне сценария),
                на вопрос отвечает ИИ с учётом базы знаний и истории диалога.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <Label htmlFor="ai-enabled" className="text-sm font-medium">
                    Включить ИИ-ассистента
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Клиент может задать любой вопрос — бот ответит нейросетью
                  </p>
                </div>
                <Switch
                  id="ai-enabled"
                  checked={cfg.enabled}
                  onCheckedChange={(v) => setCfg((c) => ({ ...c, enabled: v }))}
                />
              </div>

              {cfg.enabled && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-prompt">Личность и тон ассистента</Label>
                    <Textarea
                      id="ai-prompt"
                      rows={4}
                      placeholder={DEFAULT_PROMPT}
                      value={cfg.prompt}
                      onChange={(e) => setCfg((c) => ({ ...c, prompt: e.target.value }))}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-muted-foreground">
                        Инструкция для нейросети: кто вы, как отвечать, чего избегать.
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px] text-muted-foreground"
                        onClick={() => setCfg((c) => ({ ...c, prompt: DEFAULT_PROMPT }))}
                      >
                        <RotateCcw className="h-3 w-3" /> Шаблон
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <Label htmlFor="ai-reask" className="text-sm font-medium">
                        Показывать меню после ответа
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        После ответа ИИ пользователь снова видит кнопки сценария
                      </p>
                    </div>
                    <Switch
                      id="ai-reask"
                      checked={cfg.reaskMenu}
                      onCheckedChange={(v) => setCfg((c) => ({ ...c, reaskMenu: v }))}
                    />
                  </div>

                  <div className="rounded-lg border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
                    <b className="text-foreground">Как это работает:</b> вопрос клиента не попадает
                    на кнопку сценария → ассистент отвечает по базе знаний → клиент возвращается в
                    меню. Просит живого человека → диалог уходит оператору. В блоках «ИИ-ответ»
                    конструктора тоже используется эта база знаний.
                  </div>
                </>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={saveCfg} disabled={savingCfg || !dirty}>
                  {savingCfg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Сохранить настройки
                </Button>
                {dirty && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    Есть несохранённые изменения
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* База знаний */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <BookOpen className="h-5 w-5 shrink-0 text-primary" aria-hidden /> База знаний
                  </CardTitle>
                  <CardDescription>
                    Факты о компании: графики, цены, доставка, возвраты, контакты…
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing({ id: null, title: '', content: '' })}
                  disabled={kbBusy}
                >
                  <Plus className="h-4 w-4" /> Добавить
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {knowledge.length === 0 && !editing && (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <BookOpen className="h-6 w-6" aria-hidden />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Записей пока нет</p>
                    <p className="mt-1 max-w-[320px] text-sm text-muted-foreground">
                      Добавьте ответы на частые вопросы — ассистент будет опираться на них при
                      ответах.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={kbBusy}
                    onClick={() => setEditing({ id: null, title: '', content: '' })}
                  >
                    <Plus className="h-4 w-4" /> Добавить запись
                  </Button>
                </div>
              )}

              {editing && (
                <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm font-medium">
                      {editing.id ? 'Изменить запись' : 'Новая запись'}
                    </Label>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditing(null)}
                      aria-label="Отменить редактирование"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input
                    placeholder="Заголовок: например «График работы»"
                    aria-label="Заголовок записи"
                    value={editing.title}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  />
                  <Textarea
                    rows={4}
                    placeholder="Содержимое: пн–пт с 9:00 до 18:00 МСК…"
                    aria-label="Содержимое записи"
                    value={editing.content}
                    onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveItem} disabled={kbBusy}>
                      {kbBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Сохранить
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                      Отмена
                    </Button>
                  </div>
                </div>
              )}

              {knowledge.length > 0 && (
                <div
                  className="max-h-96 overflow-y-auto rounded-lg border"
                  role="list"
                  aria-label="Записи базы знаний"
                >
                  <div className="divide-y">
                    {knowledge.map((k) => (
                      <div
                        key={k.id}
                        role="listitem"
                        className={cn(
                          'group flex items-start justify-between gap-2 p-3',
                          editing?.id === k.id && 'hidden'
                        )}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{k.title}</div>
                          <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">
                            {k.content}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1 opacity-70 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Изменить запись «${k.title}»`}
                            onClick={() =>
                              setEditing({ id: k.id, title: k.title, content: k.content })
                            }
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            aria-label={`Удалить запись «${k.title}»`}
                            onClick={() => setDeleteTarget(k)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Правая колонка: тест-чат */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Bot className="h-5 w-5 shrink-0 text-primary" aria-hidden /> Проверить ассистента
                </CardTitle>
                <CardDescription>
                  {cfg.enabled
                    ? 'Задайте вопрос — ответит нейросеть'
                    : 'Включите ассистента, чтобы проверять ответы нейросети'}
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetChat} aria-label="Сбросить чат">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              ref={scrollRef}
              aria-live="polite"
              aria-label="История сообщений тестового чата"
              className="h-80 min-h-0 space-y-2 overflow-y-auto rounded-lg border bg-muted/40 p-3"
            >
              {chat.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Sparkles className="h-6 w-6" aria-hidden />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Начните диалог</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Напишите вопрос, как это сделает клиент
                    </p>
                  </div>
                  {cfg.enabled && kbSuggestions.length > 0 && (
                    <div className="flex max-w-[90%] flex-wrap justify-center gap-1.5">
                      {kbSuggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => send(s)}
                          disabled={sending}
                          className="max-w-full truncate rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {chat.map((m) => (
                <div
                  key={m.id}
                  className={cn('flex min-w-0', m.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm leading-snug sm:max-w-[75%]',
                      m.role === 'user'
                        ? 'rounded-br-md bg-primary text-primary-foreground'
                        : 'rounded-bl-md bg-muted'
                    )}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {(() => {
                const lastBot = [...chat].reverse().find((m) => m.role === 'bot');
                const buttons = lastBot?.buttons ?? [];
                if (buttons.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {buttons.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => send(b.text)}
                        disabled={sending}
                        className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                      >
                        {b.text}
                      </button>
                    ))}
                  </div>
                );
              })()}
              {sending && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-muted px-3.5 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">ИИ печатает…</span>
                  </div>
                </div>
              )}
            </div>

            {handedOff && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                <span>Диалог передан оператору</span>
                <div className="flex gap-1.5">
                  {onOpenInbox && (
                    <Button size="sm" variant="outline" className="h-7" onClick={onOpenInbox}>
                      Открыть
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7" onClick={resetChat}>
                    Сбросить
                  </Button>
                </div>
              </div>
            )}

            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={cfg.enabled ? 'Ваш вопрос…' : 'Ассистент выключен — сценарий будет отвечать по сценарию'}
                disabled={sending}
                aria-label="Ваш вопрос ассистенту"
              />
              <Button type="submit" size="icon" disabled={sending || !input.trim()} aria-label="Отправить">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
            <p className="text-[11px] text-muted-foreground">
              Тест идёт по реальному сценарию бота: меню, ветвления и передача оператору работают
              как в живом боте.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Подтверждение удаления записи базы знаний — безвозвратно */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись «{deleteTarget?.title}» будет удалена из базы знаний безвозвратно. ИИ больше
              не сможет опираться на неё при ответах. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60"
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (target) deleteItem(target.id);
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
