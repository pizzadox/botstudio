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

export type ViewKey = 'dashboard' | 'editor' | 'ai' | 'channels' | 'inbox';

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

export const SOURCE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  max: 'MAX',
  web: 'Сайт',
  simulator: 'Симулятор',
};

export const SOURCE_COLORS: Record<string, string> = {
  telegram: 'bg-sky-100 text-sky-700',
  whatsapp: 'bg-emerald-100 text-emerald-700',
  max: 'bg-violet-100 text-violet-700',
  web: 'bg-amber-100 text-amber-700',
  simulator: 'bg-slate-200 text-slate-700',
};
