'use client';

import type { DragEvent } from 'react';
import { GripVertical, Plus } from 'lucide-react';
import type { FlowNodeType } from '@/lib/flow-types';
import { NODE_META } from '@/lib/flow-types';
import { NODE_ICONS } from './flow-node';
import { cn } from '@/lib/utils';

const ORDER: FlowNodeType[] = [
  'message',
  'question',
  'buttons',
  'condition',
  'ai',
  'http',
  'delay',
  'handoff',
  'end',
];

export default function NodePalette({
  onAdd,
  className,
}: {
  onAdd: (type: FlowNodeType) => void;
  className?: string;
}) {
  const handleDragStart = (e: DragEvent, type: FlowNodeType) => {
    e.dataTransfer.setData('application/botstudio', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className={cn('flex flex-col gap-1.5 overflow-y-auto p-3', className)}>
      <div className="flex items-center gap-1.5 px-1 pb-1 text-xs font-semibold text-muted-foreground">
        <Plus className="h-3.5 w-3.5" /> БЛОКИ СЦЕНАРИЯ
      </div>
      {ORDER.map((type) => {
        const meta = NODE_META[type];
        const Icon = NODE_ICONS[type];
        return (
          <button
            key={type}
            draggable
            onDragStart={(e) => handleDragStart(e, type)}
            onClick={() => onAdd(type)}
            title={`${meta.title} — ${meta.description}`}
            className="group flex cursor-grab items-center gap-2.5 rounded-xl border bg-card p-2.5 text-left transition-all hover:border-primary/50 hover:shadow-sm active:cursor-grabbing"
          >
            <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', meta.bg, meta.color)}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium leading-tight">{meta.title}</div>
              <div className="truncate text-[10px] leading-tight text-muted-foreground">
                {meta.description}
              </div>
            </div>
            <GripVertical className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
          </button>
        );
      })}
      <p className="px-1 pt-2 text-[10px] leading-relaxed text-muted-foreground">
        Перетащите блок на полотно или кликните, чтобы добавить. Соединяйте блоки, потянув за точку снизу.
      </p>
    </div>
  );
}

/** Компактная палитра для мобильных (горизонтальная лента) */
export function NodePaletteStrip({ onAdd }: { onAdd: (type: FlowNodeType) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto border-b bg-background p-2 lg:hidden">
      {ORDER.map((type) => {
        const meta = NODE_META[type];
        const Icon = NODE_ICONS[type];
        return (
          <button
            key={type}
            draggable
            onDragStart={(e) => handleDragStart(e, type)}
            onClick={() => onAdd(type)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs font-medium active:bg-muted"
          >
            <Icon className={cn('h-3.5 w-3.5', meta.color)} />
            {meta.title}
          </button>
        );
      })}
    </div>
  );
}
