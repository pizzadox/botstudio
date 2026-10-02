'use client';

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

export interface FlowCardData extends Record<string, unknown> {
  node: FlowNode;
}

export type FlowCardNode = Node<FlowCardData, 'flowCard'>;

const HANDLE_CLS = '!h-3 !w-3 !rounded-full !border-2 !border-background';

export function FlowCard({ data, selected }: NodeProps<FlowCardNode>) {
  const node = data.node;
  const meta = NODE_META[node.type];
  const Icon = NODE_ICONS[node.type];

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

  return (
    <div
      className={cn(
        'w-56 rounded-xl border-2 bg-card shadow-sm transition-all sm:w-60',
        selected ? 'border-primary shadow-lg shadow-emerald-600/10' : 'border-border hover:shadow-md'
      )}
    >
      {node.type !== 'start' && (
        <Handle type="target" position={Position.Top} className={cn(HANDLE_CLS, '!bg-slate-400', '-top-1.5')} />
      )}

      <div className="flex items-center gap-2 rounded-t-[10px] border-b bg-muted/40 p-2.5">
        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', meta.bg, meta.color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold leading-tight">
            {node.data.label || meta.title}
          </div>
          <div className="text-[10px] leading-tight text-muted-foreground">{meta.title}</div>
        </div>
      </div>

      <div className="space-y-1.5 p-2.5">
        {preview() && (
          <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{preview()}</p>
        )}
        {buttons.length > 0 && (
          <div className="flex flex-wrap gap-1 pb-1">
            {buttons.map((b) => (
              <span
                key={b.id}
                className="rounded-md border bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
              >
                {b.text}
              </span>
            ))}
          </div>
        )}
        {node.type === 'question' && node.data.variable && (
          <span className="inline-block rounded-md bg-cyan-50 px-1.5 py-0.5 text-[10px] text-cyan-700">
            → {`{{${node.data.variable}}}`}
          </span>
        )}
        {node.type === 'ai' && (
          <span className="inline-block rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">
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
          <Handle
            id="yes"
            type="source"
            position={Position.Bottom}
            style={{ left: '30%' }}
            className={cn(HANDLE_CLS, '!bg-emerald-500', '-bottom-1.5')}
          />
          <Handle
            id="no"
            type="source"
            position={Position.Bottom}
            style={{ left: '70%' }}
            className={cn(HANDLE_CLS, '!bg-rose-500', '-bottom-1.5')}
          />
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
}

export const flowNodeTypes = { flowCard: FlowCard };
