import { useEffect, useState } from 'react';

export interface ClioCitation {
  n: number;
  type: string;
  id: string;
  title: string;
  url: string | null;
  snippet: string | null;
  tool: string;
}

export interface VerifiedClaim {
  claim: string;
  supported: boolean;
  sourceIds: number[];
}

export interface ClioVerification {
  claims: VerifiedClaim[];
  totalCount: number;
  unsupportedCount: number;
  unsupportedRatio: number;
  lowConfidence: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  citations?: ClioCitation[];
  verification?: ClioVerification;
}

export interface ActiveDraftContext {
  engagementId: string;
  recipientId?: string;
  subject: string;
  body: string;
}

export interface ClioAlert {
  id: string;
  alertType: string;
  title: string;
  body: string;
  priority: string;
  status: string;
  clientId: string | null;
  createdAt: string;
}

export interface ClioConversation {
  id: string;
  title: string;
  clientId: string | null;
  client: { id: string; name: string } | null;
  latestMessage: { body: string; createdAt: string } | null;
  updatedAt: string;
}

export interface ClioSourceAttribution {
  tool: string;
  count?: number;
  summary: string;
  confidence?: 'high' | 'medium' | 'low';
}

interface ChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  sessionId: string | null;
  isStreaming: boolean;
  conversations: ClioConversation[];
  activeConversationId: string | null;
  sessionRailOpen: boolean;
  alerts: ClioAlert[];
  alertsBadge: number;
}

let state: ChatState = {
  isOpen: false,
  messages: [],
  sessionId: null,
  isStreaming: false,
  conversations: [],
  activeConversationId: null,
  sessionRailOpen: false,
  alerts: [],
  alertsBadge: 0,
};

let activeDraft: ActiveDraftContext | null = null;
let listeners: Array<() => void> = [];

function notify(): void {
  for (const l of listeners) l();
}

export function setChatOpen(open: boolean): void {
  state = { ...state, isOpen: open };
  notify();
}

export function toggleChat(): void {
  state = { ...state, isOpen: !state.isOpen };
  notify();
}

export function setChatSession(sessionId: string | null): void {
  state = { ...state, sessionId };
  notify();
}

export function appendChatMessage(message: ChatMessage): void {
  state = { ...state, messages: [...state.messages, message] };
  notify();
}

export function updateChatMessage(id: string, content: string): void {
  const messages = state.messages.map((m) => (m.id === id ? { ...m, content } : m));
  state = { ...state, messages };
  notify();
}

export function setChatMessageCitations(id: string, citations: ClioCitation[]): void {
  const messages = state.messages.map((m) => (m.id === id ? { ...m, citations } : m));
  state = { ...state, messages };
  notify();
}

export function setChatMessageVerification(id: string, verification: ClioVerification): void {
  const messages = state.messages.map((m) => (m.id === id ? { ...m, verification } : m));
  state = { ...state, messages };
  notify();
}

/** Drop every message after the one with `id` (used by regenerate / edit-and-resend). */
export function truncateMessagesAfter(id: string): void {
  const idx = state.messages.findIndex((m) => m.id === id);
  if (idx < 0) return;
  state = { ...state, messages: state.messages.slice(0, idx + 1) };
  notify();
}

export function setStreaming(streaming: boolean): void {
  state = { ...state, isStreaming: streaming };
  notify();
}

export function clearChatSession(): void {
  state = { ...state, messages: [], sessionId: null, isStreaming: false };
  notify();
}

export function setActiveDraft(draft: ActiveDraftContext | null): void {
  activeDraft = draft;
}

export function getActiveDraft(): ActiveDraftContext | null {
  return activeDraft;
}

export function setConversations(conversations: ClioConversation[]): void {
  state = { ...state, conversations };
  notify();
}

export function upsertConversation(conversation: ClioConversation): void {
  const existing = state.conversations.find((c) => c.id === conversation.id);
  const conversations = existing
    ? state.conversations.map((c) => (c.id === conversation.id ? conversation : c))
    : [conversation, ...state.conversations];
  state = { ...state, conversations };
  notify();
}

export function removeConversation(conversationId: string): void {
  const conversations = state.conversations.filter((c) => c.id !== conversationId);
  const activeConversationId = state.activeConversationId === conversationId ? null : state.activeConversationId;
  const sessionId = state.sessionId === conversationId ? null : state.sessionId;
  const messages = state.activeConversationId === conversationId ? [] : state.messages;
  state = { ...state, conversations, activeConversationId, sessionId, messages };
  notify();
}

export function setActiveConversation(id: string | null): void {
  state = { ...state, activeConversationId: id };
  notify();
}

export function toggleSessionRail(): void {
  state = { ...state, sessionRailOpen: !state.sessionRailOpen };
  notify();
}

export function setAlerts(alerts: ClioAlert[]): void {
  state = { ...state, alerts, alertsBadge: alerts.filter(a => a.status === 'pending').length };
  notify();
}

export function dismissAlert(id: string): void {
  state = { ...state, alerts: state.alerts.map(a => a.id === id ? { ...a, status: 'read' } : a), alertsBadge: Math.max(0, state.alertsBadge - 1) };
  notify();
}

export function useChatStore(): ChatState {
  const [s, setS] = useState<ChatState>(state);
  useEffect(() => {
    const l = () => setS({ ...state });
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);
  return s;
}
