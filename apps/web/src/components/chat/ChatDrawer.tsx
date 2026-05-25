import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  CloseOutlined,
  DeleteOutlined,
  FileTextOutlined,
  HistoryOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../../env.js';
import { useClientFilter } from '../../state/client-filter.js';
import { useImpersonation } from '../../state/impersonation.js';
import {
  appendChatMessage,
  clearChatSession,
  ClioSourceAttribution,
  getActiveDraft,
  removeConversation,
  setAlerts,
  setActiveConversation,
  setChatOpen,
  setChatSession,
  setStreaming,
  toggleChat,
  toggleEmailPanel,
  toggleSessionRail,
  updateChatMessage,
  upsertConversation,
  useChatStore,
} from './chat-store.js';
import { ChatInput } from './ChatInput.js';
import { ChatMessage } from './ChatMessage.js';
import { ArtifactPanel } from './ArtifactPanel.js';
import { SessionRail } from './SessionRail.js';
import './chat.css';

type SseEvent =
  | { type: 'start'; intent: string }
  | { type: 'text'; text: string }
  | { type: 'sources'; sources: ClioSourceAttribution[] }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'draft_updated'; engagementId: string; recipientId?: string; subject: string; body: string }
  | { type: 'workflow_updated'; instanceId: string; fieldKey: string; updatedValue: string };

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

interface ClientOption {
  id: string;
  name: string;
}

function toolNameLabel(tool: string): string {
  return tool
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

interface ChatDrawerProps {
  selectedClientName?: string | null;
}

export function ChatDrawer({ selectedClientName }: ChatDrawerProps) {
  const { isOpen, messages, sessionId, isStreaming, alertsBadge, conversations, activeConversationId } = useChatStore();
  const { getToken } = useAuth();
  const { actAsTenantSlug } = useImpersonation();
  const { selectedClientId } = useClientFilter();
  const location = useLocation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionClientId, setSessionClientId] = useState('');
  const [sourceBadges, setSourceBadges] = useState<ClioSourceAttribution[]>([]);
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const contextLabel =
    selectedClientName && !location.pathname.startsWith('/clients')
      ? `${contextLabelFor(location.pathname)} · ${selectedClientName}`
      : contextLabelFor(location.pathname);

  const selectedClientValue = useMemo(() => {
    if (!sessionClientId) return '';
    const found = clients.find((client) => client.id === sessionClientId);
    return found ? found.id : '';
  }, [clients, sessionClientId]);

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

  // Fetch alerts when drawer opens
  useEffect(() => {
    if (!isOpen) return;
    void (async () => {
      try {
        const res = await fetch(`${config.apiBaseUrl}/api/clio/alerts`, {
          headers: await authHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setAlerts(data);
        }
      } catch { /* ignore */ }
    })();
  }, [isOpen, authHeaders]);

  useEffect(() => {
    if (!isOpen) return;
    void (async () => {
      try {
        const res = await fetch(`${config.apiBaseUrl}/api/clients`, { headers: await authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) {
          const options = data
            .map((client) => ({ id: String(client.id ?? ''), name: String(client.name ?? '') }))
            .filter((client) => Boolean(client.id && client.name));
          setClients(options);
        }
      } catch {
        // ignore
      }
    })();
  }, [isOpen, authHeaders]);

  useEffect(() => {
    const active = conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
    setSessionTitle(active?.title ?? '');
    setSessionClientId(active?.clientId ?? selectedClientId ?? '');
    setMetaError(null);
  }, [conversations, activeConversationId, selectedClientId]);

  useEffect(() => {
    if (!messages.length) {
      setSourceBadges([]);
    }
  }, [messages.length]);

  const saveConversationMeta = useCallback(async () => {
    if (!activeConversationId || isSavingMeta) return;
    setIsSavingMeta(true);
    setMetaError(null);
    try {
      const payload: Record<string, unknown> = {};
      const trimmedTitle = sessionTitle.trim();
      if (trimmedTitle) payload.title = trimmedTitle;
      payload.clientId = selectedClientValue || null;

      const res = await fetch(`${config.apiBaseUrl}/api/clio/conversations/${activeConversationId}`, {
        method: 'PATCH',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }

      const updated = await res.json();
      if (updated && typeof updated.id === 'string') {
        upsertConversation({
          id: updated.id,
          title: updated.title,
          clientId: updated.clientId ?? null,
          client: updated.client ?? null,
          latestMessage:
            updated.latestMessage && typeof updated.latestMessage.body === 'string'
              ? { body: updated.latestMessage.body, createdAt: updated.latestMessage.createdAt }
              : null,
          updatedAt: updated.updatedAt,
        });
      }
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : 'Failed to save conversation settings');
    } finally {
      setIsSavingMeta(false);
    }
  }, [activeConversationId, authHeaders, isSavingMeta, selectedClientValue, sessionTitle]);

  const archiveConversation = useCallback(async () => {
    if (!activeConversationId) return;
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/clio/conversations/${activeConversationId}/archive`, {
        method: 'PATCH',
        headers: await authHeaders(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      removeConversation(activeConversationId);
      clearChatSession();
      setSourceBadges([]);
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : 'Failed to archive conversation');
    }
  }, [activeConversationId, authHeaders]);

  const doCreateSession = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/clio/conversations`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          clientId: selectedClientId || undefined,
          title: 'Chat session',
        }),
      });
      if (res.ok) {
        const data = await res.json() as { id: string };
        setChatSession(data.id);
        setActiveConversation(data.id);
        return data.id;
      }
    } catch {
      // fallback
    }
    return null;
  }, [authHeaders, selectedClientId]);

  const handleNewSession = useCallback(async () => {
    abortRef.current?.abort();
    clearChatSession();
    setSourceBadges([]);
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
      const res = await fetch(`${config.apiBaseUrl}/api/clio/conversations/${sid}/stream`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ body: content }),
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
          } else if (event.type === 'sources') {
            setSourceBadges(Array.isArray(event.sources) ? event.sources : []);
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

        <div className="chat-session-meta" aria-label="Conversation settings">
          <div className="chat-session-meta-row">
            <input
              className="chat-session-input"
              value={sessionTitle}
              onChange={(event) => setSessionTitle(event.target.value)}
              placeholder="Conversation title"
              maxLength={160}
            />
            <select
              className="chat-session-select"
              value={selectedClientValue}
              onChange={(event) => setSessionClientId(event.target.value)}
            >
              <option value="">General (no client)</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="chat-session-btn"
              onClick={() => void saveConversationMeta()}
              disabled={!activeConversationId || isSavingMeta}
              title="Save title/client assignment"
              aria-label="Save conversation settings"
            >
              <SaveOutlined />
            </button>
            <button
              type="button"
              className="chat-session-btn chat-session-btn--danger"
              onClick={() => void archiveConversation()}
              disabled={!activeConversationId}
              title="Archive conversation"
              aria-label="Archive conversation"
            >
              <DeleteOutlined />
            </button>
          </div>
          {metaError && <div className="chat-session-error">{metaError}</div>}
          {sourceBadges.length > 0 && (
            <div className="chat-sources" aria-label="Orchestrator sources">
              {sourceBadges.map((source) => (
                <span key={`${source.tool}:${source.summary}`} className="chat-source-pill" title={source.summary}>
                  {toolNameLabel(source.tool)}{typeof source.count === 'number' ? ` (${source.count})` : ''}
                </span>
              ))}
            </div>
          )}
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
        {alertsBadge > 0 && (
          <span className="chat-fab-badge">{alertsBadge}</span>
        )}
      </button>

      <ArtifactPanel />
    </>
  );
}
