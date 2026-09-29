'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DragEvent, MouseEvent } from 'react';
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
import { Sheet, SheetContent } from '@/components/ui/sheet';
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

function EditorInner({
  bot,
  onBack,
  onRenamed,
}: {
  bot: { id: string; name: string; status: string };
  onBack: () => void;
  onRenamed: (name: string, status: string) => void;
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

  // Автосохранение сценария (только когда есть несохранённые изменения)
  useEffect(() => {
    if (!loadedRef.current || saveState !== 'unsaved') return;
    const t = setTimeout(async () => {
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
    }, 900);
    return () => clearTimeout(t);
  }, [saveState, nodes, edges, bot.id, buildFlow]);

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

  // Обёртки над изменениями React Flow — отмечают сценарий «грязным»
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      if (loadedRef.current && changes.length > 0) setSaveState('unsaved');
      onNodesChange(changes);
    },
    [onNodesChange]
  );
  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      if (loadedRef.current && changes.length > 0) setSaveState('unsaved');
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
          <Save className="h-3.5 w-3.5 text-emerald-600" /> Сохранено
        </>
      )}
      {saveState === 'saving' && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сохранение…
        </>
      )}
      {saveState === 'unsaved' && (
        <>
          <span className="h-2 w-2 rounded-full bg-amber-500" /> Есть изменения
        </>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Хедер редактора */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label="Назад">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="h-9 w-40 border-transparent bg-transparent font-semibold shadow-none hover:border-input sm:w-56"
        />
        <Badge variant={status === 'published' ? 'default' : 'secondary'}>
          {status === 'published' ? 'Опубликован' : 'Черновик'}
        </Badge>
        <div className="hidden sm:block">{saveIndicator}</div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="publish"
              checked={status === 'published'}
              onCheckedChange={togglePublish}
              aria-label="Опубликовать бота"
            />
            <Label htmlFor="publish" className="hidden text-xs text-muted-foreground sm:block">
              Опубликован
            </Label>
          </div>
          <Button
            size="sm"
            variant={testOpen ? 'default' : 'outline'}
            onClick={() => setTestOpen((v) => !v)}
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
            <NodePalette onAdd={addNodeCenter} className="h-full" />
          </div>
        )}

        {/* Канвас */}
        <div className="relative min-w-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка сценария…
            </div>
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
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} className="bg-emerald-50/40" />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                className="!hidden md:!block"
                nodeColor={(n) => {
                  const t = (n as FlowCardNode).data.node.type;
                  const map: Record<string, string> = {
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
                  return map[t] ?? '#94a3b8';
                }}
              />
            </ReactFlow>
          )}
          {nodes.length === 0 && !loading && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-2xl border bg-card/90 px-6 py-4 text-center text-sm text-muted-foreground shadow-sm">
                <Sparkles className="mx-auto mb-2 h-5 w-5 text-primary" />
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
            <TestChat botId={bot.id} onClose={() => setTestOpen(false)} />
          </div>
        )}
      </div>

      {/* Инспектор (мобильные/узкие) */}
      <Sheet open={!isWide && !!selectedNode} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent side="bottom" className="h-[75dvh] p-0">
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
        <SheetContent side="right" className={cn('w-full p-0 sm:max-w-sm')}>
          <TestChat botId={bot.id} onClose={() => setTestOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Сохранение на мобильных */}
      <div className="border-t bg-background px-3 py-1 text-center sm:hidden">
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
