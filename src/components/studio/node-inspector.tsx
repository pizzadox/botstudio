'use client';

import { CircleHelp, ClipboardList, MousePointerClick, Plus, Settings2, ShieldCheck, Trash2, X } from 'lucide-react';
import type { ConditionOp, FlowButton, FlowNode, FlowNodeData } from '@/lib/flow-types';
import { CONDITION_OP_LABELS, NODE_META } from '@/lib/flow-types';
import { NODE_DARK, NODE_ICONS } from './flow-node';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

function randomId() {
  return Math.random().toString(36).slice(2, 8);
}

export default function NodeInspector({
  node,
  onChange,
  onDelete,
  onClose,
}: {
  node: FlowNode;
  onChange: (patch: Partial<FlowNodeData>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const meta = NODE_META[node.type];
  const Icon = NODE_ICONS[node.type];
  const d = node.data;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b p-3">
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            meta.bg,
            meta.color,
            NODE_DARK[node.type].bg,
            NODE_DARK[node.type].text
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{d.label || meta.title}</div>
          <div className="text-xs text-muted-foreground">Настройки блока</div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Закрыть">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <Label htmlFor="insp-label" className="text-xs font-medium">Название блока</Label>
            <Input
              id="insp-label"
              placeholder={meta.title}
              value={d.label ?? ''}
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </div>

          {(node.type === 'message' || node.type === 'question' || node.type === 'handoff') && (
            <div className="space-y-2">
              <Label htmlFor="insp-text" className="text-xs font-medium">
                {node.type === 'question' ? 'Текст вопроса' : 'Текст сообщения'}
              </Label>
              <Textarea
                id="insp-text"
                rows={4}
                placeholder="Что напечатать пользователю? Можно использовать {{переменная}}"
                value={d.text ?? ''}
                onChange={(e) => onChange({ text: e.target.value })}
              />
            </div>
          )}

          {node.type === 'message' && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1 text-sm font-medium">
                  <ClipboardList className="h-3.5 w-3.5" aria-hidden /> Создать заявку
                </Label>
                <Switch
                  checked={!!d.createOrder}
                  onCheckedChange={(v) =>
                    onChange({
                      createOrder: v
                        ? {
                            type: 'waste' as const,
                            phoneVar: 'phone',
                            addressVar: 'address',
                            dateVar: 'date',
                          }
                        : undefined,
                    })
                  }
                />
              </div>
              {d.createOrder && (
                <div className="space-y-3 pt-1">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-muted-foreground">Тип заявки</Label>
                    <Select
                      value={d.createOrder.type ?? 'waste'}
                      onValueChange={(v) =>
                        onChange({
                          createOrder: { ...d.createOrder, type: v as 'waste' | 'kgm' | 'other' },
                        })
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="waste">🚛 Вывоз отходов</SelectItem>
                        <SelectItem value="kgm">📦 Вывоз КГМ</SelectItem>
                        <SelectItem value="other">📋 Другое</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-muted-foreground">Перем.: адрес</Label>
                      <Input
                        className="h-9"
                        value={d.createOrder.addressVar ?? ''}
                        placeholder="address"
                        onChange={(e) =>
                          onChange({
                            createOrder: { ...d.createOrder, addressVar: e.target.value.replace(/\s/g, '_') },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-muted-foreground">Перем.: телефон</Label>
                      <Input
                        className="h-9"
                        value={d.createOrder.phoneVar ?? ''}
                        placeholder="phone"
                        onChange={(e) =>
                          onChange({
                            createOrder: { ...d.createOrder, phoneVar: e.target.value.replace(/\s/g, '_') },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-muted-foreground">Перем.: дата</Label>
                      <Input
                        className="h-9"
                        value={d.createOrder.dateVar ?? ''}
                        placeholder="date"
                        onChange={(e) =>
                          onChange({
                            createOrder: { ...d.createOrder, dateVar: e.target.value.replace(/\s/g, '_') },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-muted-foreground">Перем.: объём/состав</Label>
                      <Input
                        className="h-9"
                        value={d.createOrder.sizeVar ?? ''}
                        placeholder="container"
                        onChange={(e) =>
                          onChange({
                            createOrder: { ...d.createOrder, sizeVar: e.target.value.replace(/\s/g, '_') },
                          })
                        }
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Перед показом сообщения бот создаст заявку с номером — он подставится в {'{{order.number}}'}. Заявка появится в разделе «Заявки» на карте.
                  </p>
                </div>
              )}
            </div>
          )}

          {node.type === 'question' && (
            <div className="space-y-2">
              <Label htmlFor="insp-var" className="flex items-center gap-1 text-xs font-medium">
                <CircleHelp className="h-3.5 w-3.5" aria-hidden /> Сохранить ответ в переменную
              </Label>
              <Input
                id="insp-var"
                placeholder="например: имя"
                value={d.variable ?? ''}
                onChange={(e) => onChange({ variable: e.target.value.replace(/\s/g, '_') })}
              />
              <p className="text-[11px] text-muted-foreground">
                Ответ пользователя будет доступен как {'{{'}
                {d.variable || 'имя'}
                {'}}'} в следующих блоках.
              </p>
              <div className="space-y-2 border-t pt-3">
                <Label htmlFor="insp-validate" className="flex items-center gap-1 text-xs font-medium">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Проверка ответа
                </Label>
                <Select
                  value={d.validate ?? 'none'}
                  onValueChange={(v) => onChange({ validate: v === 'none' ? undefined : (v as 'phone' | 'address') })}
                >
                  <SelectTrigger id="insp-validate" className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без проверки</SelectItem>
                    <SelectItem value="phone">📞 Телефон (10–11 цифр)</SelectItem>
                    <SelectItem value="address">📍 Адрес (есть на карте)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  При ошибке бот переспросит. Пользователь может написать «пропустить».
                </p>
              </div>
            </div>
          )}

          {node.type === 'buttons' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="insp-btn-text" className="text-xs font-medium">Текст меню</Label>
                <Textarea
                  id="insp-btn-text"
                  rows={2}
                  placeholder="Выберите вариант:"
                  value={d.text ?? ''}
                  onChange={(e) => onChange({ text: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Кнопки (варианты ответа)</Label>
                {(d.buttons ?? []).map((b: FlowButton, i: number) => (
                  <div key={b.id} className="flex items-center gap-2">
                    <Input
                      value={b.text}
                      placeholder={`Кнопка ${i + 1}`}
                      onChange={(e) => {
                        const buttons = [...(d.buttons ?? [])];
                        buttons[i] = { ...b, text: e.target.value };
                        onChange({ buttons });
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Удалить кнопку"
                      onClick={() =>
                        onChange({ buttons: (d.buttons ?? []).filter((x: FlowButton) => x.id !== b.id) })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    onChange({
                      buttons: [...(d.buttons ?? []), { id: `b_${randomId()}`, text: '' }],
                    })
                  }
                >
                  <Plus className="h-4 w-4" /> Добавить кнопку
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Каждая кнопка — отдельная точка соединения снизу блока: тяните связь к следующему шагу.
                </p>
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                  <Label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <MousePointerClick className="h-3 w-3" aria-hidden /> Сохранить выбор кнопки в переменную
                  </Label>
                  <Input
                    className="h-9"
                    placeholder="например: container"
                    value={d.saveSelection ?? ''}
                    onChange={(e) => onChange({ saveSelection: e.target.value.replace(/\s/g, '_') })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Текст нажатой кнопки попадёт в переменную — удобно для заявки (объём контейнера).
                  </p>
                </div>
              </div>
            </>
          )}

          {node.type === 'condition' && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Переменная / значение</Label>
                <Input
                  placeholder="имя переменной, например имя"
                  value={d.condition?.left ?? ''}
                  onChange={(e) =>
                    onChange({
                      condition: {
                        left: e.target.value,
                        op: d.condition?.op ?? 'eq',
                        right: d.condition?.right ?? '',
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Оператор</Label>
                <Select
                  value={d.condition?.op ?? 'eq'}
                  onValueChange={(v) =>
                    onChange({
                      condition: {
                        left: d.condition?.left ?? '',
                        op: v as ConditionOp,
                        right: d.condition?.right ?? '',
                      },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CONDITION_OP_LABELS) as ConditionOp[]).map((op) => (
                      <SelectItem key={op} value={op}>
                        {CONDITION_OP_LABELS[op]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Сравнить с</Label>
                <Input
                  placeholder="значение или {{переменная}}"
                  value={d.condition?.right ?? ''}
                  onChange={(e) =>
                    onChange({
                      condition: {
                        left: d.condition?.left ?? '',
                        op: d.condition?.op ?? 'eq',
                        right: e.target.value,
                      },
                    })
                  }
                />
              </div>
              <div className="rounded-lg border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                Зеленая точка снизу — ветка «Да» (условие выполнено), красная — «Нет».
              </div>
            </div>
          )}

          {node.type === 'ai' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="insp-prompt" className="text-xs font-medium">Инструкция для ИИ (роль бота)</Label>
                <Textarea
                  id="insp-prompt"
                  rows={4}
                  placeholder="Ты — вежливый бот техподдержки. Отвечай кратко и по делу…"
                  value={d.prompt ?? ''}
                  onChange={(e) => onChange({ prompt: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="insp-knowledge" className="text-xs font-medium">База знаний</Label>
                <Textarea
                  id="insp-knowledge"
                  rows={6}
                  placeholder={'Часы работы: 9:00–18:00\nДоставка: 2–5 дней\nВозврат: 14 дней'}
                  value={d.knowledge ?? ''}
                  onChange={(e) => onChange({ knowledge: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">
                  ИИ будет отвечать на вопросы, опираясь на этот текст.
                </p>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="insp-memory" className="text-sm">
                    Память диалога
                  </Label>
                  <p className="text-[11px] text-muted-foreground">Учитывать историю переписки</p>
                </div>
                <Switch
                  id="insp-memory"
                  checked={d.useMemory !== false}
                  onCheckedChange={(v) => onChange({ useMemory: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="insp-bot-kb" className="text-sm">
                    База знаний ассистента
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Дополнить ответ записями из раздела «ИИ-ассистент»
                  </p>
                </div>
                <Switch
                  id="insp-bot-kb"
                  checked={d.useBotKnowledge !== false}
                  onCheckedChange={(v) => onChange({ useBotKnowledge: v })}
                />
              </div>
            </>
          )}

          {node.type === 'http' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="insp-url" className="text-xs font-medium">URL запроса</Label>
                <Input
                  id="insp-url"
                  placeholder="https://api.example.com/hook"
                  value={d.url ?? ''}
                  onChange={(e) => onChange({ url: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Метод</Label>
                <Select
                  value={d.method ?? 'GET'}
                  onValueChange={(v) => onChange({ method: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {d.method !== 'GET' && (
                <div className="space-y-2">
                  <Label htmlFor="insp-body" className="text-xs font-medium">Тело запроса (JSON)</Label>
                  <Textarea
                    id="insp-body"
                    rows={4}
                    placeholder={'{"name": "{{имя}}"}'}
                    value={d.body ?? ''}
                    onChange={(e) => onChange({ body: e.target.value })}
                  />
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Статус ответа сохранится в переменную {'{{__http_status}}'}.
              </p>
            </>
          )}

          {node.type === 'delay' && (
            <div className="space-y-2">
              <Label htmlFor="insp-sec" className="text-xs font-medium">Пауза, секунд (до 3)</Label>
              <Input
                id="insp-sec"
                type="number"
                min={0}
                max={3}
                value={d.seconds ?? 1}
                onChange={(e) => onChange({ seconds: Number(e.target.value) })}
              />
            </div>
          )}

          {node.type === 'start' && (
            <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Settings2 className="mt-0.5 h-4 w-4 shrink-0" />
              Стартовый блок — точка входа. Любое первое сообщение пользователя запускает сценарий
              отсюда.
            </div>
          )}

          {node.type === 'end' && (
            <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              Финальный блок. После него диалог завершается, а состояние сбрасывается — следующий
              вопрос начнёт сценарий заново.
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-3">
        <Button
          variant="outline"
          className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          disabled={node.type === 'start'}
        >
          <Trash2 className="h-4 w-4" />
          {node.type === 'start' ? 'Стартовый блок нельзя удалить' : 'Удалить блок'}
        </Button>
      </div>
    </div>
  );
}
