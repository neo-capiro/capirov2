import { useCallback, useEffect, useState } from 'react';
import { MailOutlined, SendOutlined, InboxOutlined, CloseOutlined, ReloadOutlined } from '@ant-design/icons';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../../env.js';
import { useImpersonation } from '../../state/impersonation.js';
import { useClientFilter } from '../../state/client-filter.js';
import { setEmailPanelOpen, useChatStore } from './chat-store.js';

interface EmailThread {
  id: string;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: string | null;
  status: string;
  client: { id: string; name: string } | null;
  messages: Array<{
    id: string;
    subject: string | null;
    fromEmail: string | null;
    fromName: string | null;
    bodyText: string | null;
    sentAt: string | null;
    receivedAt: string | null;
  }>;
}

export function EmailPanel() {
  const { emailPanelOpen } = useChatStore();
  const { getToken } = useAuth();
  const { actAsTenantSlug } = useImpersonation();
  const { selectedClientId } = useClientFilter();

  const [activeTab, setActiveTab] = useState<'inbox' | 'compose'>('inbox');
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  // Compose state
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken({ template: 'capiro' });
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(actAsTenantSlug ? { 'x-capiro-impersonate-tenant': actAsTenantSlug } : {}),
    };
  }, [getToken, actAsTenantSlug]);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedClientId) params.set('clientId', selectedClientId);
      params.set('limit', '20');
      const res = await fetch(
        `${config.apiBaseUrl}/api/clio/emails?${params}`,
        { headers: await authHeaders() },
      );
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [authHeaders, selectedClientId]);

  useEffect(() => {
    if (emailPanelOpen) void fetchEmails();
  }, [emailPanelOpen, fetchEmails]);

  const handleSend = useCallback(async () => {
    if (!composeTo || !composeSubject || !composeBody) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/clio/emails/send`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ to: composeTo, subject: composeSubject, body: composeBody }),
      });
      const data = await res.json();
      if (data.ok) {
        setSendResult(`Sent from ${data.sentFrom}`);
        setComposeTo('');
        setComposeSubject('');
        setComposeBody('');
      } else {
        setSendResult(data.error || 'Failed to send');
      }
    } catch {
      setSendResult('Network error');
    }
    setSending(false);
  }, [composeTo, composeSubject, composeBody, authHeaders]);

  const handleReply = useCallback(async (threadId: string) => {
    if (!replyBody.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/clio/emails/reply`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ threadId, body: replyBody }),
      });
      const data = await res.json();
      if (data.ok) {
        setReplyingTo(null);
        setReplyBody('');
        void fetchEmails();
      }
    } catch { /* ignore */ }
    setSending(false);
  }, [replyBody, authHeaders, fetchEmails]);

  if (!emailPanelOpen) return null;

  const formatDate = (d: string | null) => {
    if (!d) return '';
    const dt = new Date(d);
    const now = new Date();
    if (dt.toDateString() === now.toDateString()) {
      return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="clio-email-panel">
      <div className="clio-email-header">
        <span className="clio-email-header-title">
          <MailOutlined style={{ marginRight: 8 }} />
          Clio Mail
        </span>
        <div className="clio-email-header-actions">
          <button type="button" className="chat-header-btn" onClick={() => void fetchEmails()} title="Refresh">
            <ReloadOutlined />
          </button>
          <button type="button" className="chat-header-btn" onClick={() => setEmailPanelOpen(false)} aria-label="Close email panel">
            <CloseOutlined />
          </button>
        </div>
      </div>

      <div className="clio-email-tabs">
        <button
          type="button"
          className={`clio-email-tab${activeTab === 'inbox' ? ' clio-email-tab--active' : ''}`}
          onClick={() => setActiveTab('inbox')}
        >
          <InboxOutlined /> Inbox
        </button>
        <button
          type="button"
          className={`clio-email-tab${activeTab === 'compose' ? ' clio-email-tab--active' : ''}`}
          onClick={() => setActiveTab('compose')}
        >
          <SendOutlined /> Compose
        </button>
      </div>

      <div className="clio-email-body">
        {activeTab === 'inbox' && (
          <div className="clio-email-inbox">
            {loading && <div className="clio-email-loading">Loading emails...</div>}
            {!loading && threads.length === 0 && (
              <div className="clio-email-empty">No email threads found.</div>
            )}
            {threads.map((thread) => (
              <div key={thread.id} className="clio-email-thread">
                <div
                  className="clio-email-thread-header"
                  onClick={() => setExpandedThread(expandedThread === thread.id ? null : thread.id)}
                >
                  <div className="clio-email-thread-subject">
                    {thread.subject || '(no subject)'}
                    {thread.client && (
                      <span className="clio-email-thread-client">{thread.client.name}</span>
                    )}
                  </div>
                  <div className="clio-email-thread-meta">
                    {formatDate(thread.lastMessageAt)}
                  </div>
                </div>
                {thread.snippet && expandedThread !== thread.id && (
                  <div className="clio-email-thread-snippet">{thread.snippet}</div>
                )}
                {expandedThread === thread.id && (
                  <div className="clio-email-thread-messages">
                    {thread.messages.map((msg) => (
                      <div key={msg.id} className="clio-email-message">
                        <div className="clio-email-message-from">
                          {msg.fromName || msg.fromEmail} &middot; {formatDate(msg.sentAt || msg.receivedAt)}
                        </div>
                        <div className="clio-email-message-body">
                          {msg.bodyText || '(no preview)'}
                        </div>
                      </div>
                    ))}
                    {replyingTo === thread.id ? (
                      <div className="clio-email-reply-form">
                        <textarea
                          className="clio-email-reply-textarea"
                          placeholder="Type your reply..."
                          value={replyBody}
                          onChange={(e) => setReplyBody(e.target.value)}
                          rows={3}
                        />
                        <div className="clio-email-reply-actions">
                          <button
                            type="button"
                            className="clio-email-btn clio-email-btn--primary"
                            onClick={() => void handleReply(thread.id)}
                            disabled={sending || !replyBody.trim()}
                          >
                            {sending ? 'Sending...' : 'Send Reply'}
                          </button>
                          <button
                            type="button"
                            className="clio-email-btn"
                            onClick={() => { setReplyingTo(null); setReplyBody(''); }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="clio-email-btn clio-email-btn--small"
                        onClick={() => setReplyingTo(thread.id)}
                      >
                        Reply
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'compose' && (
          <div className="clio-email-compose">
            <div className="clio-email-field">
              <label className="clio-email-label">To</label>
              <input
                className="clio-email-input"
                type="email"
                placeholder="recipient@example.com"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
              />
            </div>
            <div className="clio-email-field">
              <label className="clio-email-label">Subject</label>
              <input
                className="clio-email-input"
                type="text"
                placeholder="Email subject"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
              />
            </div>
            <div className="clio-email-field">
              <label className="clio-email-label">Message</label>
              <textarea
                className="clio-email-textarea"
                placeholder="Write your email..."
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                rows={8}
              />
            </div>
            <button
              type="button"
              className="clio-email-btn clio-email-btn--primary clio-email-btn--full"
              onClick={() => void handleSend()}
              disabled={sending || !composeTo || !composeSubject || !composeBody}
            >
              {sending ? 'Sending...' : 'Send Email'}
            </button>
            {sendResult && <div className="clio-email-result">{sendResult}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
