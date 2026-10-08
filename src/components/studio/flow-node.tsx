'use client';

import { memo } from 'react';
import {
  CircleHelp,
  FlagTriangleRight,
  GitBranch,
  Globe,
  Headset,
  ListTree,
  MessageSquare,
  Sparkles,
  Timer,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { FlowNode, FlowNodeType } from '@/lib/flow-types';
import { NODE_META } from '@/lib/flow-types';
import { cn } from '@/lib/utils';

export const NODE_ICONS: Record<FlowNodeType, LucideIcon> = {
  start: Zap,
  message: MessageSquare,
  question: CircleHelp,
  buttons: ListTree,
  condition: GitBranch,
  ai: Sparkles,
  http: Globe,
  delay: Timer,
  handoff: Headset,
  end: FlagTriangleRight,
};

/**
 * Dark-пары к цветам из NODE_META (файл flow-types.ts не редактируем):
 * bg — фон кружка иконки, text — цвет иконки/текста в тёмной теме.
 */
export const NODE_DARK: Record<FlowNodeType, { bg: string; text: string }> = {
  start: { bg: 'dark:bg-emerald-500/15', text: 'dark:text-emerald-300' },
  message: { bg: 'dark:bg-teal-500/15', text: 'dark:text-teal-300' },
  question: { bg: 'dark:bg-cyan-500/15', text: 'dark:text-cyan-300' },
  buttons: { bg: 'dark:bg-amber-500/15', text: 'dark:text-amber-300' },
  condition: { bg: 'dark:bg-orange-500/15', text: 'dark:text-orange-300' },
  ai: { bg: 'dark:bg-violet-500/15', text: 'dark:text-violet-300' },
  http: { bg: 'dark:bg-fuchsia-500/15', text: 'dark:text-fuchsia-300' },
  delay: { bg: 'dark:bg-slate-500/20', text: 'dark:text-slate-300' },
  handoff: { bg: 'dark:bg-rose-500/15', text: 'dark:text-rose-300' },
  end: { bg: 'dark:bg-slate-500/20', text: 'dark:text-slate-300' },
};

export interface FlowCardData extends Record<string, unknown> {
  node: FlowNode;
}

export type FlowCardNode = Node<FlowCardData, 'flowCard'>;

const HANDLE_CLS = '!h-3 !w-3 !rounded-full !border-2 !border-background';

/**
 * IMP-F22: memo — при наборе текста в инспекторе (или drag'е одного узла) ReactFlow
 * меняет ссылку data только у изменённого узла, остальные 60+ карточек не перерисовываются.
 * Props от ReactFlow стабильны: updateNode/drag создают новые объекты только для
 * затронутых узлов, selected меняется только при выделении.
 */
export const FlowCard = memo(function FlowCard({ data, selected }: NodeProps<FlowCardNode>) {
  const node = data.node;
  const meta = NODE_META[node.type];
  const Icon = NODE_ICONS[node.type];

  // IMP-FE22-11: ненастроенный узел — янтарная точка в шапке (текст/url не заполнены)
  const isUnconfigured = (): boolean => {
    switch (node.type) {
      case 'message':
      case 'question':
      case 'handoff':
        return !node.data.text?.trim();
      case 'http':
        return !node.data.url?.trim();
      default:
        return false;
    }
  };

  const preview = (): string | null => {
    switch (node.type) {
      case 'message':
      case 'question':
      case 'handoff':
        return node.data.text ?? null;
      case 'buttons':
        return node.data.text ?? null;
      case 'ai':
        return node.data.prompt ? `✨ ${node.data.prompt}` : 'Ответ нейросети';
      case 'http':
        return node.data.url ?? null;
      case 'condition': {
        const c = node.data.condition;
        return c ? `${c.left} ${c.op} ${c.right}` : null;
      }
      case 'delay':
        return `${node.data.seconds ?? 1} сек`;
      default:
        return null;
    }
  };

  const buttons = node.type === 'buttons' ? node.data.buttons ?? [] : [];
  const isCondition = node.type === 'condition';
  // IMP-FE22-12б: чипы кнопок — первые 6, остальные скрыты за «+N»
  const visibleButtons = buttons.slice(0, 6);
  const hiddenButtons = buttons.slice(6);

  return (
    <div
      className={cn(
        'relative w-56 rounded-lg border bg-card shadow-sm transition-shadow sm:w-60',
        selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'hover:shadow-md'
      )}
    >
      {node.type !== 'start' && (
        <Handle type="target" position={Position.Top} className={cn(HANDLE_CLS, '!bg-slate-400', '-top-1.5')} />
      )}

      <div className="flex items-center gap-2 rounded-t-[7px] border-b bg-muted/40 p-2.5">
        <div
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            meta.bg,
            meta.color,
            NODE_DARK[node.type].bg,
            NODE_DARK[node.type].text
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        {/* IMP-FE22-12в: без своего label не дублируем meta.title в подзаголовке */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold leading-tight">
            {node.data.label?.trim() || meta.title}
          </div>
          {node.data.label?.trim() && (
            <div className="text-[10px] leading-tight text-muted-foreground">{meta.title}</div>
          )}
        </div>
        {isUnconfigured() && (
          // IMP-FE22-11: маркер «не настроен» (пустой текст/url)
          <span
            role="img"
            aria-label="Не настроен"
            title="Не настроен"
            className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
          />
        )}
      </div>

      <div className="space-y-1.5 p-2.5">
        {preview() && (
          <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{preview()}</p>
        )}
        {buttons.length > 0 && (
          <div className="flex flex-wrap gap-1 pb-1">
            {visibleButtons.map((b) => (
              <span
                key={b.id}
                className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] leading-tight text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300"
              >
                {b.text}
              </span>
            ))}
            {hiddenButtons.length > 0 && (
              <span
                title={hiddenButtons.map((b) => b.text).join('\n')}
                className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300"
              >
                +{hiddenButtons.length}
              </span>
            )}
          </div>
        )}
        {node.type === 'question' && node.data.variable && (
          <span className="inline-block rounded-full border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[10px] leading-tight text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-300">
            → {`{{${node.data.variable}}}`}
          </span>
        )}
        {node.type === 'ai' && (
          <span className="inline-block rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] leading-tight text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300">
            {node.data.useMemory !== false ? 'с памятью' : 'без памяти'}
          </span>
        )}
      </div>

      {/* Исходящие коннекторы */}
      {node.type === 'buttons' &&
        buttons.map((b, i) => (
          <Handle
            key={b.id}
            id={b.id}
            type="source"
            position={Position.Bottom}
            style={{ left: `${((i + 1) / (buttons.length + 1)) * 100}%` }}
            className={cn(HANDLE_CLS, '!bg-amber-500', '-bottom-1.5')}
          />
        ))}
      {isCondition && (
        <>
          {/* IMP-FE22-12б: хендлы 16px (hit-area) + подписи «да»/«нет» */}
          <Handle
            id="yes"
            type="source"
            position={Position.Bottom}
            style={{ left: '30%' }}
            className={cn(HANDLE_CLS, '!h-4 !w-4 !bg-emerald-500', '-bottom-1.5')}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-[22px] left-[30%] -translate-x-1/2 text-[9px] leading-none text-muted-foreground"
          >
            да
          </span>
          <Handle
            id="no"
            type="source"
            position={Position.Bottom}
            style={{ left: '70%' }}
            className={cn(HANDLE_CLS, '!h-4 !w-4 !bg-rose-500', '-bottom-1.5')}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-[22px] left-[70%] -translate-x-1/2 text-[9px] leading-none text-muted-foreground"
          >
            нет
          </span>
        </>
      )}
      {!['buttons', 'condition', 'end'].includes(node.type) && (
        <Handle
          type="source"
          position={Position.Bottom}
          className={cn(HANDLE_CLS, meta.color.includes('emerald') ? '!bg-emerald-500' : '!bg-slate-400', '-bottom-1.5')}
        />
      )}
    </div>
  );
});

export const flowNodeTypes = { flowCard: FlowCard };
