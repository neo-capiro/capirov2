import { useEffect, useState } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface ActiveDraftContext {
  engagementId: string;
  recipientId?: string;
  subject: string;
  body: string;
}

export interface ClioConversation {
  id: string;
  title: string;
  clientId: string | null;
  client: { id: string; name: string } | null;
  latestMessage: { body: string; createdAt: string } | null;
  updatedAt: string;
}

interface ChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  sessionId: string | null;
  isStreaming: boolean;
  emailPanelOpen: boolean;
  conversations: ClioConversation[];
  activeConversationId: string | null;
  sessionRailOpen: boolean;
}

let state: ChatState = {
  isOpen: false,
  messages: [],
  sessionId: null,
  isStreaming: false,
  emailPanelOpen: false,
  conversations: [],
  activeConversationId: null,
  sessionRailOpen: false,
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

export function setEmailPanelOpen(open: boolean): void {
  state = { ...state, emailPanelOpen: open };
  notify();
}

export function toggleEmailPanel(): void {
  state = { ...state, emailPanelOpen: !state.emailPanelOpen };
  notify();
}

export function setConversations(conversations: ClioConversation[]): void {
  state = { ...state, conversations };
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
