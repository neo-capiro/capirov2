import { useCallback, useEffect, useState } from 'react';
import { FileTextOutlined, CloseOutlined, ReloadOutlined } from '@ant-design/icons';
import { useAuth } from '@clerk/clerk-react';
import { config } from '../../env.js';
import { useImpersonation } from '../../state/impersonation.js';
import { setEmailPanelOpen, useChatStore } from './chat-store.js';

interface ClioArtifact {
  id: string;
  title: string;
  kind: string;
  contentType: string | null;
  bodyText: string | null;
  createdAt: string;
  conversationId?: string;
  clientId?: string | null;
}

interface ConversationWithArtifacts {
  id: string;
  title: string;
  client: { id: string; name: string } | null;
  artifacts?: ClioArtifact[];
}

export function ArtifactPanel() {
  const { emailPanelOpen } = useChatStore();
  const { getToken } = useAuth();
  const { actAsTenantSlug } = useImpersonation();

  const [artifacts, setArtifacts] = useState<(ClioArtifact & { clientName?: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState('');

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken({ template: 'capiro' });
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(actAsTenantSlug ? { 'x-capiro-impersonate-tenant': actAsTenantSlug } : {}),
    };
  }, [getToken, actAsTenantSlug]);

  const fetchArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/clio/conversations`, {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const conversations: ConversationWithArtifacts[] = await res.json();
        const all: (ClioArtifact & { clientName?: string })[] = [];
        for (const conv of conversations) {
          if (conv.artifacts) {
            for (const a of conv.artifacts) {
              all.push({ ...a, conversationId: conv.id, clientName: conv.client?.name });
            }
          }
        }
        // Sort newest first
        all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setArtifacts(all);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => {
    if (emailPanelOpen) void fetchArtifacts();
  }, [emailPanelOpen, fetchArtifacts]);

  const handleSaveEdit = useCallback(async (artifactId: string) => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/clio/artifacts/${artifactId}/version`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ bodyText: editBody }),
      });
      if (res.ok) {
        setEditing(false);
        void fetchArtifacts();
      }
    } catch { /* ignore */ }
  }, [editBody, authHeaders, fetchArtifacts]);

  if (!emailPanelOpen) return null;

  const selected = selectedId ? artifacts.find((a) => a.id === selectedId) : null;

  const formatDate = (d: string) => {
    const dt = new Date(d);
    const now = new Date();
    if (dt.toDateString() === now.toDateString()) {
      return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const kindLabel = (kind: string) => {
    const labels: Record<string, string> = {
      meeting_brief: 'Meeting Brief',
      policy_memo: 'Policy Memo',
      email_sent: 'Sent Email',
      email_reply: 'Email Reply',
      note: 'Note',
      document: 'Document',
    };
    return labels[kind] || kind;
  };

  const kindColor = (kind: string) => {
    const colors: Record<string, string> = {
      meeting_brief: '#7c3aed',
      policy_memo: '#0891b2',
      email_sent: '#2563eb',
      email_reply: '#2563eb',
      note: '#059669',
      document: '#6b7280',
    };
    return colors[kind] || '#6b7280';
  };

  return (
    <div className="clio-email-panel">
      <div className="clio-email-header">
        <span className="clio-email-header-title">
          <FileTextOutlined style={{ marginRight: 8 }} />
          Clio Artifacts
        </span>
        <div className="clio-email-header-actions">
          <button type="button" className="chat-header-btn" onClick={() => void fetchArtifacts()} title="Refresh">
            <ReloadOutlined />
          </button>
          <button type="button" className="chat-header-btn" onClick={() => setEmailPanelOpen(false)} aria-label="Close artifacts panel">
            <CloseOutlined />
          </button>
        </div>
      </div>

      <div className="clio-artifact-panel-body">
        {/* Artifact list sidebar */}
        <div className="clio-artifact-list-pane">
          {loading && <div className="clio-email-loading">Loading artifacts...</div>}
          {!loading && artifacts.length === 0 && (
            <div className="clio-email-empty">
              <FileTextOutlined style={{ fontSize: 24, opacity: 0.3 }} />
              <div style={{ marginTop: 8 }}>No artifacts yet.</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Ask Clio to create a meeting brief, draft a policy memo, or send an email.</div>
            </div>
          )}
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              className={`clio-artifact-list-item${artifact.id === selectedId ? ' clio-artifact-list-item--active' : ''}`}
              onClick={() => setSelectedId(artifact.id === selectedId ? null : artifact.id)}
            >
              <div className="clio-artifact-list-item-head">
                <span className="clio-artifact-kind-badge" style={{ background: kindColor(artifact.kind) }}>
                  {kindLabel(artifact.kind)}
                </span>
                <span className="clio-artifact-list-item-time">{formatDate(artifact.createdAt)}</span>
              </div>
              <div className="clio-artifact-list-item-title">{artifact.title}</div>
              {artifact.clientName && (
                <div className="clio-artifact-list-item-client">{artifact.clientName}</div>
              )}
            </button>
          ))}
        </div>

        {/* Artifact detail view */}
        {selected && (
          <div className="clio-artifact-detail">
            <div className="clio-artifact-detail-header">
              <span className="clio-artifact-kind-badge" style={{ background: kindColor(selected.kind) }}>
                {kindLabel(selected.kind)}
              </span>
              <h3 className="clio-artifact-detail-title">{selected.title}</h3>
              {selected.clientName && (
                <span className="clio-artifact-detail-client">{selected.clientName}</span>
              )}
              <time className="clio-artifact-detail-time">{new Date(selected.createdAt).toLocaleString()}</time>
              <button
                type="button"
                className="clio-email-btn clio-email-btn--small"
                onClick={() => { setEditing(!editing); setEditBody(selected.bodyText || ''); }}
              >
                {editing ? 'Cancel' : 'Edit'}
              </button>
            </div>
            {editing ? (
              <div>
                <textarea
                  className="clio-artifact-edit-textarea"
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={12}
                />
                <button
                  type="button"
                  className="clio-email-btn clio-email-btn--primary"
                  onClick={() => void handleSaveEdit(selected.id)}
                >
                  Save New Version
                </button>
              </div>
            ) : (
              <pre className="clio-artifact-detail-body">
                {selected.bodyText || 'Artifact content is stored outside text view.'}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
