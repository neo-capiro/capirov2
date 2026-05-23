import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { CloseOutlined, FileTextOutlined, HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../../env.js';
import { useClientFilter } from '../../state/client-filter.js';
import { useImpersonation } from '../../state/impersonation.js';
import {
  appendChatMessage,
  clearChatSession,
  getActiveDraft,
  setChatOpen,
  setChatSession,
  setStreaming,
  toggleChat,
  toggleEmailPanel,
  toggleSessionRail,
  updateChatMessage,
  useChatStore,
} from './chat-store.js';
import { ChatInput } from './ChatInput.js';
import { ChatMessage } from './ChatMessage.js';
import { ArtifactPanel } from './ArtifactPanel.js';
import { SessionRail } from './SessionRail.js';
import './chat.css';

type SseEvent =
  | { type: 'text'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'draft_updated'; engagementId: string; recipientId?: string; subject: string; body: string }
  | { type: 'workflow_updated'; instanceId: string; fieldKey: string; updatedValue: string };

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function pageKeyFor(pathname: string): string {
  if (pathname.startsWith('/engagement')) return 'engagement';
  if (pathname.startsWith('/intelligence')) return 'intelligence';
  if (pathname.startsWith('/workspace')) return 'workspace';
  if (pathname.startsWith('/directory')) return 'directory';
  if (pathname.startsWith('/clients')) return 'clients';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'other';
}

function contextLabelFor(pathname: string): string {
  const draft = getActiveDraft();
  if (pathname.startsWith('/engagement') && draft) {
    const name = draft.subject ? `"${draft.subject}"` : 'outreach draft';
    return `Editing: ${name}`;
  }
  if (pathname.startsWith('/engagement')) return 'Engagement Manager';
  if (pathname.startsWith('/intelligence')) return 'Intelligence Center';
  if (pathname.startsWith('/workspace')) return 'Workspace';
  if (pathname.startsWith('/directory')) return 'Directory';
  if (pathname.startsWith('/clients')) return 'Portfolio';
  if (pathname.startsWith('/settings')) return 'Settings';
  return 'Capiro';
}

interface ChatDrawerProps {
  selectedClientName?: string | null;
}

export function ChatDrawer({ selectedClientName }: ChatDrawerProps) {
  const { isOpen, messages, sessionId, isStreaming } = useChatStore();
  const { getToken } = useAuth();
  const { actAsTenantSlug } = useImpersonation();
  const { selectedClientId } = useClientFilter();
  const location = useLocation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const contextLabel =
    selectedClientName && !location.pathname.startsWith('/clients')
      ? `${contextLabelFor(location.pathname)} · ${selectedClientName}`
      : contextLabelFor(location.pathname);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Create session on first open
  useEffect(() => {
    if (!isOpen || sessionId) return;
    void doCreateSession();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const authHeaders = useCallback(
    async (): Promise<Record<string, string>> => {
      const token = await getToken({ template: 'capiro' });
      return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(actAsTenantSlug ? { 'x-capiro-impersonate-tenant': actAsTenantSlug } : {}),
      };
    },
    [getToken, actAsTenantSlug],
  );

  const doCreateSession = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/chat/session`, {
        method: 'POST',
        headers: await authHeaders(),
      });
      if (res.ok) {
        const data = await res.json() as { sessionId: string };
        setChatSession(data.sessionId);
        return data.sessionId;
      }
    } catch {
      // session creation failed; messages will still send without a persistent session
    }
    return null;
  }, [authHeaders]);

  const handleNewSession = useCallback(async () => {
    abortRef.current?.abort();
    clearChatSession();
    await doCreateSession();
  }, [doCreateSession]);

  const sendMessage = useCallback(async (content: string) => {
    if (isStreaming) return;

    // Ensure we have a session ID (create one if missing)
    let sid = sessionId;
    if (!sid) {
      sid = await doCreateSession();
    }

    appendChatMessage({ id: generateId(), role: 'user', content, createdAt: new Date() });

    const assistantId = generateId();
    appendChatMessage({ id: assistantId, role: 'assistant', content: '', createdAt: new Date() });

    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const draft = getActiveDraft();
      const context: Record<string, unknown> = {
        page: pageKeyFor(location.pathname),
        ...(selectedClientId ? { clientId: selectedClientId } : {}),
        ...(selectedClientName ? { clientName: selectedClientName } : {}),
        ...(draft
          ? {
              engagementId: draft.engagementId,
              recipientId: draft.recipientId,
              draftSubject: draft.subject,
              draftBody: draft.body,
            }
          : {}),
      };

      const res = await fetch(`${config.apiBaseUrl}/api/chat/message`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ content, sessionId: sid, context }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        updateChatMessage(assistantId, `Error ${res.status}: ${text || res.statusText}`);
        return;
      }

      if (!res.body) {
        updateChatMessage(assistantId, 'No response body received.');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          let event: SseEvent;
          try {
            event = JSON.parse(jsonStr) as SseEvent;
          } catch {
            continue;
          }

          if (event.type === 'text') {
            accumulated += event.text;
            updateChatMessage(assistantId, accumulated);
          } else if (event.type === 'done') {
            break outer;
          } else if (event.type === 'error') {
            updateChatMessage(assistantId, `Error: ${event.message}`);
            break outer;
          } else if (event.type === 'draft_updated') {
            window.dispatchEvent(
              new CustomEvent('capiro:draft-updated', {
                detail: {
                  engagementId: event.engagementId,
                  recipientId: event.recipientId,
                  subject: event.subject,
                  body: event.body,
                },
              }),
            );
          } else if (event.type === 'workflow_updated') {
            window.dispatchEvent(
              new CustomEvent('capiro:workflow-field-updated', {
                detail: {
                  instanceId: event.instanceId,
                  fieldKey: event.fieldKey,
                  updatedValue: event.updatedValue,
                },
              }),
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      updateChatMessage(assistantId, 'Failed to get a response. Please try again.');
    } finally {
      setStreaming(false);
    }
  }, [isStreaming, sessionId, doCreateSession, authHeaders, selectedClientId, selectedClientName, location.pathname]);

  const handleClose = () => setChatOpen(false);

  const showTypingIndicator =
    isStreaming &&
    messages.length > 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    messages[messages.length - 1]?.content === '';

  return (
    <>
      {isOpen && (
        <div
          className="chat-backdrop"
          onClick={handleClose}
          aria-hidden="true"
        />
      )}

      <div
        className={`chat-drawer${isOpen ? ' chat-drawer--open' : ''}`}
        role="complementary"
        aria-label="Clio assistant"
        aria-hidden={!isOpen}
      >
        <div className="chat-header">
          <span className="chat-header-title">
            <span className="chat-header-dot" aria-hidden="true" />
            Clio
          </span>
          <div className="chat-header-actions">
            <button
              type="button"
              className="chat-header-btn"
              onClick={toggleSessionRail}
              title="Conversation history"
              aria-label="Toggle conversation history"
            >
              <HistoryOutlined />
            </button>
            <button
              type="button"
              className="chat-header-btn"
              onClick={toggleEmailPanel}
              title="Artifacts"
              aria-label="Toggle artifacts panel"
            >
              <FileTextOutlined />
            </button>
            <button
              type="button"
              className="chat-header-btn"
              onClick={() => void handleNewSession()}
              title="New conversation"
              aria-label="Start new conversation"
            >
              <PlusOutlined />
            </button>
            <button
              type="button"
              className="chat-header-btn"
              onClick={handleClose}
              aria-label="Close Clio"
            >
              <CloseOutlined />
            </button>
          </div>
        </div>

        <div className="chat-context-bar">
          <span className="chat-context-icon" aria-hidden="true">●</span>
          <span className="chat-context-value">{contextLabel}</span>
        </div>

        <SessionRail />

        <div className="chat-messages" role="log" aria-live="polite" aria-label="Conversation">
          {messages.length === 0 && !isStreaming && (
            <div className="chat-empty">
              <div className="chat-empty-icon" aria-hidden="true">✦</div>
              <p className="chat-empty-text">
                Hello! I&rsquo;m Clio, your workspace assistant. Ask me about your clients, intelligence,
                engagements, or workflows &mdash; or ask me to edit a draft.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatMessage
              key={msg.id}
              role={msg.role}
              content={msg.content}
              isStreaming={
                isStreaming &&
                i === messages.length - 1 &&
                msg.role === 'assistant' &&
                msg.content !== ''
              }
            />
          ))}

          {showTypingIndicator && (
            <div className="chat-typing" aria-label="Clio is typing">
              <span />
              <span />
              <span />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area">
          <ChatInput disabled={isStreaming} onSend={(c) => void sendMessage(c)} />
        </div>
      </div>

      {/* Toggle FAB — only visible when drawer is closed */}
      <button
        type="button"
        className={`chat-toggle-fab${isOpen ? ' chat-toggle-fab--hidden' : ''}`}
        onClick={toggleChat}
        aria-label="Open Clio"
        title="Clio"
        aria-expanded={isOpen}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z"
            fill="currentColor"
          />
        </svg>
      </button>

      <ArtifactPanel />
    </>
  );
}
