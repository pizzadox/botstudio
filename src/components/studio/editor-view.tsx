'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import {
  ChevronLeft,
  Loader2,
  MessageSquareText,
  Radio,
  Save,
  Sparkles,
} from 'lucide-react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  MarkerType,
  type Connection,
  type Edge,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { api } from '@/lib/client-api';
import { NODE_META } from '@/lib/flow-types';
import type { Flow, FlowNode, FlowNodeData, FlowNodeType } from '@/lib/flow-types';
import type { BotDetail } from '@/lib/studio-types';
import { flowNodeTypes, type FlowCardNode } from './flow-node';
import NodePalette, { NodePaletteStrip } from './node-palette';
import NodeInspector from './node-inspector';
import TestChat from './test-chat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

function defaultDataFor(type: FlowNodeType): FlowNodeData {
  switch (type) {
    case 'message':
      return { label: 'Сообщение', text: 'Введите текст сообщения…' };
    case 'question':
      return { label: 'Вопрос', text: 'Как вас зовут?', variable: 'имя' };
    case 'buttons':
      return {
        label: 'Меню',
        text: 'Выберите вариант:',
        buttons: [
          { id: `b_${Math.random().toString(36).slice(2, 8)}`, text: 'Вариант 1' },
          { id: `b_${Math.random().toString(36).slice(2, 8)}`, text: 'Вариант 2' },
        ],
      };
    case 'condition':
      return { label: 'Условие', condition: { left: '', op: 'eq', right: '' } };
    case 'ai':
      return {
        label: 'ИИ-ответ',
        prompt: 'Ты — вежливый бот техподдержки. Отвечай кратко и по делу.',
        knowledge: '',
        useMemory: true,
      };
    case 'http':
      return { label: 'HTTP-запрос', url: 'https://', method: 'GET' };
    case 'delay':
      return { label: 'Пауза', seconds: 1 };
    case 'handoff':
      return { label: 'Оператор', text: 'Передаю диалог живому оператору…' };
    case 'end':
      return { label: 'Конец' };
    default:
      return { label: NODE_META[type].title };
  }
}

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onStoreChange) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', onStoreChange);
      return () => m.removeEventListener('change', onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

// IMP-F24: карта цветов MiniMap вынесена на уровень модуля — не пересоздаётся на каждый рендер
const NODE_COLOR_MAP: Record<string, string> = {
  start: '#10b981',
  message: '#14b8a6',
  question: '#06b6d4',
  buttons: '#f59e0b',
  condition: '#f97316',
  ai: '#8b5cf6',
  http: '#d946ef',
  delay: '#64748b',
  handoff: '#f43f5e',
  end: '#64748b',
};
const DEFAULT_NODE_COLOR = '#94a3b8';

// IMP-F25: скелетон загрузки канваса — композиция повторяет форму реальной карточки узла
function FlowCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('w-56 rounded-lg border bg-card shadow-sm sm:w-60', className)}>
      <div className="flex items-center gap-2 rounded-t-[7px] border-b bg-muted/40 p-2.5">
        <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1">
          <Skeleton className="h-2.5 w-3/4" />
          <Skeleton className="h-2 w-1/2" />
        </div>
      </div>
      <div className="space-y-1.5 p-2.5">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-2/3" />
      </div>
    </div>
  );
}

function CanvasSkeleton() {
  return (
    <div role="status" className="relative h-full w-full overflow-hidden">
      <FlowCardSkeleton className="absolute left-[8%] top-[10%]" />
      <FlowCardSkeleton className="absolute left-[40%] top-[34%] hidden sm:block" />
      <FlowCardSkeleton className="absolute left-[14%] top-[58%]" />
      <span className="sr-only">Загружаем сценарий…</span>
    </div>
  );
}

/** Скелетон колонки палитры на время загрузки сценария (9 блоков, как в реальной палитре) */
function PaletteSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full flex-col gap-1.5 overflow-hidden p-3">
      <Skeleton className="h-3.5 w-28 shrink-0" />
      {Array.from({ length: 9 }, (_, i) => (
        <Skeleton key={i} className="h-[52px] w-full shrink-0 rounded-lg" />
      ))}
    </div>
  );
}

function EditorInner({
  bot,
  onBack,
  onRenamed,
  onOpenInbox,
}: {
  bot: { id: string; name: string; status: string };
  onBack: () => void;
  onRenamed: (name: string, status: string) => void;
  onOpenInbox?: () => void;
}) {
  const { toast } = useToast();
  const { screenToFlowPosition, fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowCardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(bot.name);
  const [status, setStatus] = useState(bot.status);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [testOpen, setTestOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isWide = useMediaQuery('(min-width: 1440px)');

  // Загрузка сценария
  useEffect(() => {
    let alive = true;
    api<{ bot: BotDetail }>(`/api/bots/${bot.id}`)
      .then(({ bot: b }) => {
        if (!alive) return;
        let flow: Flow = { nodes: [], edges: [] };
        try {
          flow = JSON.parse(b.flow) as Flow;
        } catch {
          flow = { nodes: [], edges: [] };
        }
        setName(b.name);
        setStatus(b.status);
        setNodes(
          flow.nodes.map((n) => ({
            id: n.id,
            type: 'flowCard' as const,
            position: n.position,
            data: { node: n },
          }))
        );
        setEdges(
          flow.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? undefined,
            targetHandle: e.targetHandle ?? undefined,
            markerEnd: { type: MarkerType.ArrowClosed },
          }))
        );
        requestAnimationFrame(() => requestAnimationFrame(() => fitView({ padding: 0.15 })));
      })
      .catch(() => toast({ title: 'Не удалось загрузить сценарий', variant: 'destructive' }))
      .finally(() => {
        loadedRef.current = true;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [bot.id]);

  const buildFlow = useCallback((): Flow => {
    return {
      nodes: nodes.map((n) => n.data.node),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      })),
    };
  }, [nodes, edges]);

  // Немедленное сохранение сценария — используется и автосейвом, и Ctrl/Cmd+S (IMP-F19)
  const saveNow = useCallback(async () => {
    setSaveState('saving');
    try {
      await api(`/api/bots/${bot.id}`, {
        method: 'PUT',
        body: JSON.stringify({ flow: buildFlow() }),
      });
      setSaveState('saved');
    } catch {
      setSaveState('unsaved');
    }
  }, [buildFlow, bot.id]);

  // Автосохранение сценария (debounce 900 мс, только когда есть несохранённые изменения)
  useEffect(() => {
    if (!loadedRef.current || saveState !== 'unsaved') return;
    const t = setTimeout(saveNow, 900);
    return () => clearTimeout(t);
  }, [saveState, nodes, edges, bot.id, saveNow]);

  // IMP-F19: Ctrl/Cmd+S — форс-сохранение сценария. e.code — для нелатинских раскладок (Ctrl+Ы)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 's' || e.code === 'KeyS')) {
        e.preventDefault();
        if (saveState === 'unsaved') void saveNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveState, saveNow]);

  // IMP-F20: Esc закрывает инспектор, затем тест-чат; не мешаем полям ввода и Radix-диалогам
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      // Открыт Radix-диалог/шит/меню/селект — он закрывается сам
      if (document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]')) return;
      if (selectedId) {
        setSelectedId(null);
        e.preventDefault();
      } else if (testOpen) {
        setTestOpen(false);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, testOpen]);

  // IMP-F21: предупреждение при закрытии/перезагрузке вкладки с несохранёнными правками
  useEffect(() => {
    if (saveState === 'saved') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveState]);

  const addNode = useCallback(
    (type: FlowNodeType, position: XYPosition) => {
      const id = `n_${Math.random().toString(36).slice(2, 10)}`;
      const flowNode: FlowNode = { id, type, position, data: defaultDataFor(type) };
      setSaveState('unsaved');
      setNodes((nds) => [
        ...nds.map((n) => ({ ...n, selected: false })),
        { id, type: 'flowCard' as const, position, data: { node: flowNode }, selected: true },
      ]);
      setSelectedId(id);
    },
    [setNodes]
  );

  const addNodeCenter = useCallback(
    (type: FlowNodeType) => {
      const position = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2.2,
      });
      addNode(type, { x: position.x - 120 + Math.random() * 80, y: position.y + Math.random() * 60 });
    },
    [addNode, screenToFlowPosition]
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/botstudio') as FlowNodeType;
      if (!type || !NODE_META[type]) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(type, position);
    },
    [addNode, screenToFlowPosition]
  );

  const onConnect = useCallback(
    (c: Connection) => {
      setSaveState('unsaved');
      setEdges((eds) => {
        const filtered = eds.filter(
          (e) =>
            !(
              e.source === c.source &&
              (e.sourceHandle ?? '') === (c.sourceHandle ?? '') &&
              e.target !== c.target
            )
        );
        const withoutSelfDup = filtered.filter(
          (e) => !(e.source === c.source && e.target === c.target && (e.sourceHandle ?? '') === (c.sourceHandle ?? ''))
        );
        return [
          ...withoutSelfDup,
          {
            ...c,
            id: `e_${Math.random().toString(36).slice(2, 10)}`,
            markerEnd: { type: MarkerType.ArrowClosed },
          } as Edge,
        ];
      });
    },
    [setEdges]
  );

  const isValidConnection = useCallback(
    (c: Edge | Connection) => {
      if (c.source === c.target) return false;
      const target = nodes.find((n) => n.id === c.target);
      return target?.data.node.type !== 'start';
    },
    [nodes]
  );

  const onNodeClick = (_: MouseEvent, node: FlowCardNode) => setSelectedId(node.id);

  const selectedNode: FlowNode | null = nodes.find((n) => n.id === selectedId)?.data.node ?? null;

  const updateNode = useCallback(
    (nodeId: string, patch: Partial<FlowNodeData>) => {
      setSaveState('unsaved');
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, node: { ...n.data.node, data: { ...n.data.node.data, ...patch } } } }
            : n
        )
      );
    },
    [setNodes]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setSaveState('unsaved');
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedId(null);
    },
    [setNodes, setEdges]
  );

  // Обёртки над изменениями React Flow — отмечают сценарий «грязным».
  // IMP-F23: позиция/размер/выделение не меняют содержимое сценария — функциональный сет
  // не даёт лишнего ре-рендера, когда состояние уже 'unsaved' (drag = десятки событий на
  // mousemove). Контентные изменения (add/remove/replace) сетятся напрямую, как раньше.
  // Autosave-таймер не затронут: он пересоздаётся по изменению самих nodes/edges.
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      if (loadedRef.current && changes.length > 0) {
        const geometryOnly = changes.every(
          (c) => c.type === 'position' || c.type === 'dimensions' || c.type === 'select'
        );
        setSaveState((prev) => (geometryOnly && prev === 'unsaved' ? prev : 'unsaved'));
      }
      onNodesChange(changes);
    },
    [onNodesChange]
  );
  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      if (loadedRef.current && changes.length > 0) {
        const selectionOnly = changes.every((c) => c.type === 'select');
        setSaveState((prev) => (selectionOnly && prev === 'unsaved' ? prev : 'unsaved'));
      }
      onEdgesChange(changes);
    },
    [onEdgesChange]
  );

  const saveName = async () => {
    const n = name.trim();
    if (!n || n === bot.name) return;
    try {
      await api(`/api/bots/${bot.id}`, { method: 'PUT', body: JSON.stringify({ name: n }) });
      onRenamed(n, status);
      toast({ title: 'Название сохранено' });
    } catch {
      toast({ title: 'Не удалось сохранить название', variant: 'destructive' });
    }
  };

  const togglePublish = async (published: boolean) => {
    const next = published ? 'published' : 'draft';
    setStatus(next);
    try {
      await api(`/api/bots/${bot.id}`, { method: 'PUT', body: JSON.stringify({ status: next }) });
      onRenamed(name, next);
      toast({
        title: published ? '🚀 Бот опубликован' : 'Бот снят с публикации',
        description: published
          ? 'Он отвечает в подключённых каналах и демо-чате'
          : 'Каналы больше не отвечают, симулятор работает',
      });
    } catch {
      setStatus(published ? 'draft' : 'published');
      toast({ title: 'Ошибка публикации', variant: 'destructive' });
    }
  };

  const saveIndicator = (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {saveState === 'saved' && (
        <>
          <Save aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Сохранено
        </>
      )}
      {saveState === 'saving' && (
        <>
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> Сохранение…
        </>
      )}
      {saveState === 'unsaved' && (
        <>
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" /> Есть изменения
        </>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Хедер редактора */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        {/* Группа: навигация и имя бота */}
        <div className="flex min-w-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onBack} aria-label="Назад к дашборду">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Название бота"
            className="h-9 w-28 min-w-0 border-transparent bg-transparent font-semibold shadow-none hover:border-input sm:w-56"
          />
          <Badge variant={status === 'published' ? 'default' : 'secondary'} className="shrink-0">
            {status === 'published' ? 'Опубликован' : 'Черновик'}
          </Badge>
        </div>

        {/* Группа: статус сохранения */}
        <div className="hidden items-center border-l pl-2 sm:flex">
          {saveIndicator}
          <span
            className="ml-2 hidden text-[11px] text-muted-foreground sm:inline"
            title="Сохранить сценарий: Ctrl+S (⌘S)"
          >
            Ctrl+S — сохранить
          </span>
        </div>

        {/* Группа: публикация и тест */}
        <div className="ml-auto flex items-center gap-2 border-l pl-2">
          <div className="flex items-center gap-2">
            <Switch
              id="publish"
              checked={status === 'published'}
              onCheckedChange={togglePublish}
              aria-label="Опубликовать бота"
            />
            <Label htmlFor="publish" className="hidden text-xs text-muted-foreground sm:block">
              {status === 'published' ? 'Опубликован' : 'Черновик'}
            </Label>
          </div>
          <Button
            size="sm"
            variant={testOpen ? 'default' : 'outline'}
            onClick={() => setTestOpen((v) => !v)}
            aria-pressed={testOpen}
          >
            <MessageSquareText className="h-4 w-4" />
            Тест
          </Button>
        </div>
      </div>

      {/* Мобильная палитра */}
      <NodePaletteStrip onAdd={addNodeCenter} />

      {/* Рабочая область */}
      <div className="relative flex min-h-0 flex-1">
        {/* Палитра (десктоп) */}
        {isDesktop && (
          <div className="w-56 shrink-0 border-r bg-muted/30 xl:w-60">
            {loading ? <PaletteSkeleton /> : <NodePalette onAdd={addNodeCenter} className="h-full" />}
          </div>
        )}

        {/* Канвас */}
        <div className="relative min-w-0 flex-1">
          {loading ? (
            <CanvasSkeleton />
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onDrop={onDrop}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              nodeTypes={flowNodeTypes}
              onNodeClick={onNodeClick}
              onPaneClick={() => setSelectedId(null)}
              isValidConnection={isValidConnection}
              deleteKeyCode={['Delete']}
              snapToGrid
              snapGrid={[16, 16]}
              fitView
              minZoom={0.2}
              maxZoom={1.5}
              proOptions={{ hideAttribution: false }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} className="bg-emerald-50/40 dark:bg-emerald-500/5" />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                className="!hidden md:!block"
                nodeColor={(n) => NODE_COLOR_MAP[(n as FlowCardNode).data.node.type] ?? DEFAULT_NODE_COLOR}
              />
            </ReactFlow>
          )}
          {nodes.length === 0 && !loading && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-xl border bg-card/95 px-6 py-4 text-center text-sm text-muted-foreground shadow-lg backdrop-blur">
                <Sparkles aria-hidden="true" className="mx-auto mb-2 h-5 w-5 text-primary" />
                Перетащите блок из палитры
                <br />
                или кликните по нему, чтобы добавить
              </div>
            </div>
          )}
        </div>

        {/* Инспектор (широкие экраны) */}
        {isWide && selectedNode && (
          <div className="w-80 shrink-0 border-l">
            <NodeInspector
              node={selectedNode}
              onChange={(patch) => updateNode(selectedNode.id, patch)}
              onDelete={() => deleteNode(selectedNode.id)}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}

        {/* Тест-чат (десктоп) */}
        {isDesktop && testOpen && (
          <div className="w-80 shrink-0 border-l xl:w-96">
            <TestChat botId={bot.id} onClose={() => setTestOpen(false)} onOpenInbox={onOpenInbox} />
          </div>
        )}
      </div>

      {/* Инспектор (мобильные/узкие) */}
      <Sheet open={!isWide && !!selectedNode} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent side="bottom" className="h-[75dvh] p-0">
          <VisuallyHidden>
            <SheetTitle>Свойства блока</SheetTitle>
            <SheetDescription>Редактирование параметров выбранного блока сценария</SheetDescription>
          </VisuallyHidden>
          {selectedNode && (
            <NodeInspector
              node={selectedNode}
              onChange={(patch) => updateNode(selectedNode.id, patch)}
              onDelete={() => deleteNode(selectedNode.id)}
              onClose={() => setSelectedId(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Тест-чат (мобильные) */}
      <Sheet open={!isDesktop && testOpen} onOpenChange={setTestOpen}>
        <SheetContent
          side="right"
          className={cn('w-full p-0 sm:max-w-sm', "[&>[data-slot=sheet-close]]:hidden")}
        >
          <VisuallyHidden>
            <SheetTitle>Тестовый чат</SheetTitle>
            <SheetDescription>Проверка сценария бота в режиме реального диалога</SheetDescription>
          </VisuallyHidden>
          <TestChat botId={bot.id} onClose={() => setTestOpen(false)} onOpenInbox={onOpenInbox} />
        </SheetContent>
      </Sheet>

      {/* Сохранение на мобильных */}
      <div className="border-t bg-background px-3 py-1.5 text-center sm:hidden">
        {saveIndicator}
      </div>
    </div>
  );
}

export default function EditorView(
  props: Parameters<typeof EditorInner>[0]
) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}
