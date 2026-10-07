// Общие клиентские типы студии

export interface SessionUser {
  id: string;
  username: string;
  name: string | null;
}

export interface BotListItem {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  /// Состояние интеграции MyTKO (для бейджа на карточке бота); null — интеграция не настроена
  mytko?: { enabled: boolean; hasToken: boolean } | null;
  channelsCount: number;
  conversationsCount: number;
  channelTypes: string[];
}

export interface Stats {
  bots: number;
  conversations: number;
  messages: number;
  needsOperator: number;
  activeChannels: number;
}

export interface BotDetail {
  id: string;
  name: string;
  description: string | null;
  status: string;
  flow: string;
}

export interface ChannelItem {
  id: string;
  botId: string;
  type: 'telegram' | 'whatsapp' | 'max' | 'web';
  title: string;
  token: string | null;
  phone: string | null;
  secret: string;
  active: boolean;
  lastStatus: string | null;
  createdAt: string;
}

export interface ConversationListItem {
  id: string;
  source: string;
  contact: string | null;
  externalId: string | null;
  needsOperator: boolean;
  status: string;
  /** Есть непрочитанное сообщение от клиента (для бейджа «новое») */
  unread: boolean;
  messagesCount: number;
  updatedAt: string;
  lastMessage: { role: string; text: string; createdAt: string } | null;
}

export interface ChatMessage {
  id: string;
  role: string;
  text: string;
  nodeId?: string | null;
  createdAt: string;
}

export type ViewKey = 'dashboard' | 'editor' | 'ai' | 'channels' | 'inbox' | 'orders';

export interface AiConfig {
  enabled: boolean;
  prompt: string;
  reaskMenu: boolean;
}

export interface KnowledgeItemDto {
  id: string;
  botId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Заявки (вывоз отходов / КГМ) ──────────────────────────────────────────

export interface OrderDto {
  id: string;
  botId: string;
  conversationId: string | null;
  externalUserId: string | null;
  number: number;
  type: string;
  clientName: string | null;
  /** Город обслуживания (выбор города в боте / у оператора) */
  city: string | null;
  phone: string | null;
  address: string | null;
  size: string | null;
  wishDate: string | null;
  comment: string | null;
  status: string;
  assignee: string | null;
  lat: number | null;
  lng: number | null;
  /** Как получены координаты: manual — указаны оператором, geocode — по адресу */
  geoSource: 'manual' | 'geocode' | null;
  /** Синхронизация с MyTKO: synced — сверено, error — ошибка, null — ещё не синхронизировалось */
  mytkoStatus: 'synced' | 'error' | null;
  mytkoSyncAt: string | null;
  /** Сводка из MyTKO (машина/факт вывоза или пояснение) */
  mytkoInfo: string | null;
  mytkoError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  conversation?: {
    contact: string | null;
    source: string;
    externalUserId: string | null;
    needsOperator?: boolean;
  } | null;
  messagesCount?: number;
}

export interface OrderMessageDto {
  id: string;
  role: string;
  text: string;
  nodeId?: string | null;
  orderId?: string | null;
  createdAt: string;
}

/** Метки синхронизации с MyTKO (везде, где видна заявка) */
export const MYTKO_BADGES: Record<string, { label: string; cls: string; title: string }> = {
  synced: {
    label: 'MyTKO ✓',
    cls: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    title: 'Синхронизировано с MyTKO (Чистая логистика)',
  },
  error: {
    label: 'MyTKO !',
    cls: 'bg-rose-100 text-rose-800 border-rose-200',
    title: 'Ошибка синхронизации с MyTKO — нажмите «Синхронизировать» в карточке заявки',
  },
  none: {
    label: 'MyTKO —',
    cls: 'bg-slate-100 text-slate-500 border-slate-200',
    title: 'Не синхронизировано с MyTKO',
  },
};

export function mytkoBadgeKey(status: string | null | undefined): 'synced' | 'error' | 'none' {
  if (status === 'synced' || status === 'error') return status;
  return 'none';
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  assigned: 'Назначена',
  in_progress: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

export const ORDER_STATUS_BADGES: Record<string, string> = {
  new: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  assigned: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
  in_progress: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30',
  completed: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  cancelled: 'bg-slate-200 text-slate-600 border-slate-300 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30',
};

export const ORDER_TYPE_LABELS: Record<string, string> = {
  waste: 'Вывоз отходов',
  kgm: 'Вывоз КГМ',
  other: 'Другое',
};

export const ORDER_TYPE_ICONS: Record<string, string> = {
  waste: '🚛',
  kgm: '📦',
  other: '📋',
};

export const SOURCE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  max: 'MAX',
  web: 'Сайт',
  simulator: 'Симулятор',
};

export const SOURCE_COLORS: Record<string, string> = {
  telegram: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  whatsapp: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  max: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  web: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  simulator: 'bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
};
