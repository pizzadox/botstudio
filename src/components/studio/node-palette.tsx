'use client';

import type { DragEvent } from 'react';
import { GripVertical, Plus } from 'lucide-react';
import type { FlowNodeType } from '@/lib/flow-types';
import { NODE_META } from '@/lib/flow-types';
import { NODE_DARK, NODE_ICONS } from './flow-node';
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

const handleDragStart = (e: DragEvent, type: FlowNodeType) => {
  e.dataTransfer.setData('application/botstudio', type);
  e.dataTransfer.effectAllowed = 'move';
};

export default function NodePalette({
  onAdd,
  className,
}: {
  onAdd: (type: FlowNodeType) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 overflow-y-auto p-3', className)}>
      <div className="flex items-center gap-1.5 px-1 pb-1 text-xs font-semibold text-muted-foreground">
        <Plus className="h-3.5 w-3.5" aria-hidden /> БЛОКИ СЦЕНАРИЯ
      </div>
      {ORDER.map((type) => {
        const meta = NODE_META[type];
        const Icon = NODE_ICONS[type];
        return (
          // IMP-32-06: glass снят с чипа (backdrop-blur портит drag image и держит постоянный
          // blur-слой) — border + bg-card/85 dark:bg-card/90, как узлы канваса (IMP-28-FEB,
          // flow-node.tsx:115-118); glass-hover ОСТАВЛЕН (без blur — transform+shadow);
          // min-h-11/фокус-ринг/cursor-grab не тронуты
          <button
            key={type}
            draggable
            onDragStart={(e) => handleDragStart(e, type)}
            onClick={() => onAdd(type)}
            title={`${meta.title} — ${meta.description}`}
            aria-label={`${meta.title}: ${meta.description}`}
            className="group glass-hover border bg-card/85 dark:bg-card/90 flex min-h-11 w-full cursor-grab items-center gap-2.5 rounded-lg p-2 text-left hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 active:cursor-grabbing active:bg-primary/10 active:ring-1 active:ring-primary/30 dark:hover:bg-primary/15 dark:active:bg-primary/15"
          >
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                meta.bg,
                meta.color,
                NODE_DARK[type].bg,
                NODE_DARK[type].text
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium leading-tight">{meta.title}</div>
              <div className="truncate text-[10px] leading-tight text-muted-foreground">
                {meta.description}
              </div>
            </div>
            <GripVertical className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" aria-hidden />
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
    // IMP-28-FEB: мобильная лента палитры — плотное стекло вместо bg-background
    <div className="glass-strong flex gap-2 overflow-x-auto border-b p-2 lg:hidden">
      {ORDER.map((type) => {
        const meta = NODE_META[type];
        const Icon = NODE_ICONS[type];
        return (
          // IMP-32-06: glass снят (тот же drag-фикс, что на десктопе) — border +
          // bg-card/85 dark:bg-card/90; glass-hover оставлен; min-h-11 не тронут
          <button
            key={type}
            draggable
            onDragStart={(e) => handleDragStart(e, type)}
            onClick={() => onAdd(type)}
            aria-label={`Добавить блок «${meta.title}»`}
            className="glass-hover border bg-card/85 dark:bg-card/90 flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 active:bg-primary/10 active:ring-1 active:ring-primary/30 dark:hover:bg-primary/15 dark:active:bg-primary/15"
          >
            <Icon className={cn('h-3.5 w-3.5', meta.color, NODE_DARK[type].text)} aria-hidden />
            {meta.title}
          </button>
        );
      })}
    </div>
  );
}
