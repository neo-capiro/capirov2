import { useCallback, useEffect, useState } from 'react';
import { UserOutlined, MessageOutlined, DownOutlined, RightOutlined } from '@ant-design/icons';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../../env.js';
import { useImpersonation } from '../../state/impersonation.js';
import {
  ClioConversation,
  setConversations,
  setActiveConversation,
  setChatSession,
  clearChatSession,
  appendChatMessage,
  useChatStore,
} from './chat-store.js';

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

interface ClientGroup {
  clientId: string | null;
  clientName: string;
  conversations: ClioConversation[];
}

export function SessionRail() {
  const { conversations, activeConversationId, sessionRailOpen } = useChatStore();
  const { getToken } = useAuth();
  const { actAsTenantSlug } = useImpersonation();
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set(['__general__']));
  const [loading, setLoading] = useState(false);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken({ template: 'capiro' });
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(actAsTenantSlug ? { 'x-capiro-impersonate-tenant': actAsTenantSlug } : {}),
    };
  }, [getToken, actAsTenantSlug]);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/clio/conversations`, {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => {
    if (sessionRailOpen) void fetchConversations();
  }, [sessionRailOpen, fetchConversations]);

  const loadConversation = useCallback(async (conv: ClioConversation) => {
    clearChatSession();
    setActiveConversation(conv.id);
    setChatSession(conv.id);
    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/clio/conversations/${conv.id}/messages`,
        { headers: await authHeaders() },
      );
      if (res.ok) {
        const msgs = await res.json();
        if (Array.isArray(msgs)) {
          for (const m of msgs) {
            appendChatMessage({
              id: m.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              role: m.role === 'user' ? 'user' : 'assistant',
              content: m.body || '',
              createdAt: new Date(m.createdAt),
            });
          }
        }
      }
    } catch { /* ignore */ }
  }, [authHeaders]);

  if (!sessionRailOpen) return null;

  // Group conversations by client
  const groups: ClientGroup[] = [];
  const clientMap = new Map<string, ClientGroup>();

  for (const conv of conversations) {
    const key = conv.clientId || '__general__';
    let group = clientMap.get(key);
    if (!group) {
      group = {
        clientId: conv.clientId,
        clientName: conv.client?.name || 'General',
        conversations: [],
      };
      clientMap.set(key, group);
      groups.push(group);
    }
    group.conversations.push(conv);
  }

  const toggleClient = (key: string) => {
    setExpandedClients((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="clio-session-rail">
      {loading && <div className="clio-rail-loading">Loading conversations...</div>}
      {!loading && groups.length === 0 && (
        <div className="clio-rail-empty">No conversations yet. Start chatting!</div>
      )}
      {groups.map((group) => {
        const key = group.clientId || '__general__';
        const isExpanded = expandedClients.has(key);
        return (
          <div key={key} className="clio-rail-group">
            <button
              type="button"
              className="clio-rail-group-header"
              onClick={() => toggleClient(key)}
            >
              <span className="clio-rail-group-icon">
                {isExpanded ? <DownOutlined /> : <RightOutlined />}
              </span>
              <UserOutlined style={{ marginRight: 6, opacity: 0.5 }} />
              <span className="clio-rail-group-name">{group.clientName}</span>
              <span className="clio-rail-group-count">{group.conversations.length}</span>
            </button>
            {isExpanded && (
              <div className="clio-rail-group-items">
                {group.conversations.map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    className={`clio-rail-item${conv.id === activeConversationId ? ' clio-rail-item--active' : ''}`}
                    onClick={() => void loadConversation(conv)}
                  >
                    <MessageOutlined className="clio-rail-item-icon" />
                    <div className="clio-rail-item-content">
                      <div className="clio-rail-item-title">{conv.title}</div>
                      {conv.latestMessage && (
                        <div className="clio-rail-item-snippet">
                          {conv.latestMessage.body.slice(0, 60)}
                          {conv.latestMessage.body.length > 60 ? '...' : ''}
                        </div>
                      )}
                    </div>
                    <span className="clio-rail-item-time">
                      {relativeTime(conv.updatedAt)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
