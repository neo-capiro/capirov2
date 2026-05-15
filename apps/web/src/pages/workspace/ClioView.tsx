import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileTextOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App as AntApp, Avatar, Button, Input, Select, Spin, Typography } from 'antd';
import { useApi } from '../../lib/use-api.js';

interface ClioStatus {
  brand: 'Clio';
  runtime: string;
  configured: boolean;
  healthy: boolean;
  detail: string;
  user: {
    id: string;
    email: string | null;
    displayName: string;
  };
}

interface ClioConversation {
  id: string;
  title: string;
  clientId: string | null;
  workspaceKey: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; name: string } | null;
  latestMessage?: ClioMessage | null;
  artifacts?: ClioArtifact[];
}

interface ClioMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  body: string;
  createdAt: string;
  artifacts?: ClioArtifact[];
}

interface ClioArtifact {
  id: string;
  title: string;
  kind: string;
  contentType: string | null;
  bodyText: string | null;
  createdAt: string;
}

interface ClientSummary {
  id: string;
  name: string;
  status: string;
}

interface SendMessageResponse {
  userMessage: ClioMessage;
  assistantMessages: ClioMessage[];
  artifacts: ClioArtifact[];
}

export function ClioView() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const status = useQuery<ClioStatus>({
    queryKey: ['clio-status'],
    queryFn: async () => (await api.get<ClioStatus>('/api/clio/status')).data,
    staleTime: 15_000,
    retry: false,
  });

  const conversations = useQuery<ClioConversation[]>({
    queryKey: ['clio-conversations'],
    queryFn: async () => (await api.get<ClioConversation[]>('/api/clio/conversations')).data,
    staleTime: 10_000,
  });

  const clients = useQuery<ClientSummary[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<ClientSummary[]>('/api/clients')).data,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (activeId || !conversations.data?.length) return;
    const firstConversation = conversations.data[0];
    if (firstConversation) setActiveId(firstConversation.id);
  }, [activeId, conversations.data]);

  const activeConversation = useMemo(
    () => conversations.data?.find((conversation) => conversation.id === activeId) ?? null,
    [activeId, conversations.data],
  );

  const messages = useQuery<ClioMessage[]>({
    queryKey: ['clio-messages', activeId],
    queryFn: async () =>
      (await api.get<ClioMessage[]>(`/api/clio/conversations/${activeId}/messages`)).data,
    enabled: Boolean(activeId),
    staleTime: 5_000,
  });

  const artifacts = useMemo(() => {
    const byId = new Map<string, ClioArtifact>();
    for (const artifact of activeConversation?.artifacts ?? []) byId.set(artifact.id, artifact);
    for (const msg of messages.data ?? []) {
      for (const artifact of msg.artifacts ?? []) byId.set(artifact.id, artifact);
    }
    return [...byId.values()].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
  }, [activeConversation?.artifacts, messages.data]);

  useEffect(() => {
    if (activeArtifactId && artifacts.some((artifact) => artifact.id === activeArtifactId)) return;
    setActiveArtifactId(artifacts[0]?.id ?? null);
  }, [activeArtifactId, artifacts]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.data?.length, activeId]);

  const createConversation = useMutation({
    mutationFn: async () =>
      (
        await api.post<ClioConversation>('/api/clio/conversations', {
          title: 'New Clio session',
          clientId: selectedClientId,
        })
      ).data,
    onSuccess: (conversation) => {
      qc.invalidateQueries({ queryKey: ['clio-conversations'] });
      setActiveId(conversation.id);
      setDraft('');
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const sendMessage = useMutation({
    mutationFn: async (body: string) => {
      if (!activeId) throw new Error('Start a Clio session first.');
      return (
        await api.post<SendMessageResponse>(`/api/clio/conversations/${activeId}/messages`, {
          body,
        })
      ).data;
    },
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['clio-conversations'] });
      qc.invalidateQueries({ queryKey: ['clio-messages', activeId] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const selectedArtifact =
    artifacts.find((artifact) => artifact.id === activeArtifactId) ?? artifacts[0] ?? null;
  const canSend =
    Boolean(activeId) && Boolean(status.data?.healthy) && draft.trim().length > 0 && !sendMessage.isPending;

  const submit = () => {
    const body = draft.trim();
    if (!body || !canSend) return;
    sendMessage.mutate(body);
  };

  return (
    <section className="clio-workspace" aria-label="Clio workspace">
      <aside className="clio-session-rail" aria-label="Clio sessions">
        <div className="clio-rail-head">
          <span>
            <RobotOutlined />
            <strong>Clio</strong>
          </span>
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            loading={createConversation.isPending}
            onClick={() => createConversation.mutate()}
          >
            New
          </Button>
        </div>

        <div className="clio-runtime-strip">
          <span className={`clio-runtime-dot ${status.data?.healthy ? 'is-ready' : 'is-offline'}`} />
          <span>{status.data?.healthy ? 'Runtime online' : 'Runtime offline'}</span>
        </div>

        <Select
          className="clio-client-select"
          size="small"
          allowClear
          showSearch
          placeholder="Client context"
          optionFilterProp="label"
          loading={clients.isLoading}
          value={selectedClientId}
          onChange={(value) => setSelectedClientId(value)}
          options={(clients.data ?? [])
            .filter((client) => client.status !== 'archived')
            .map((client) => ({ value: client.id, label: client.name }))}
        />

        <div className="clio-session-list">
          {conversations.isLoading ? (
            <Spin size="small" />
          ) : conversations.data?.length ? (
            conversations.data.map((conversation) => (
              <button
                key={conversation.id}
                className={`clio-session-row${conversation.id === activeId ? ' is-active' : ''}`}
                type="button"
                onClick={() => setActiveId(conversation.id)}
              >
                <span>{conversation.title}</span>
                <small>{conversation.client?.name ?? relativeTime(conversation.updatedAt)}</small>
              </button>
            ))
          ) : (
            <div className="clio-empty-rail">No sessions yet</div>
          )}
        </div>
      </aside>

      <main className="clio-dialog-panel">
        {!status.data?.healthy ? (
          <Alert
            type={status.data?.configured ? 'warning' : 'info'}
            showIcon
            message="Clio runtime is not ready"
            description={status.data?.detail ?? 'Checking Clio runtime status...'}
            className="clio-runtime-alert"
          />
        ) : null}

        <div className="clio-dialog-head">
          <div>
            <Typography.Title level={3}>Clio</Typography.Title>
            <Typography.Text type="secondary">
              {status.data?.user.email
                ? `Signed in as ${status.data.user.email}`
                : 'Signed in through Capiro'}
            </Typography.Text>
          </div>
          <span>{activeConversation?.client?.name ?? 'Workspace'}</span>
        </div>

        <div className="clio-message-stream" ref={scrollRef}>
          {!activeId ? (
            <div className="clio-start-state">
              <RobotOutlined />
              <Typography.Title level={4}>Start a Clio session</Typography.Title>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                loading={createConversation.isPending}
                onClick={() => createConversation.mutate()}
              >
                New session
              </Button>
            </div>
          ) : messages.isLoading ? (
            <div className="clio-loading-state">
              <Spin />
            </div>
          ) : messages.data?.length ? (
            messages.data.map((msg) => (
              <article key={msg.id} className={`clio-message clio-message--${msg.role}`}>
                <Avatar icon={msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />} />
                <div>
                  <header>
                    <strong>{msg.role === 'user' ? 'You' : 'Clio'}</strong>
                    <time dateTime={msg.createdAt}>{timeLabel(msg.createdAt)}</time>
                  </header>
                  <p>{msg.body}</p>
                  {msg.artifacts?.length ? (
                    <div className="clio-message-artifacts">
                      {msg.artifacts.map((artifact) => (
                        <button
                          key={artifact.id}
                          type="button"
                          onClick={() => setActiveArtifactId(artifact.id)}
                        >
                          <FileTextOutlined />
                          <span>{artifact.title}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            ))
          ) : (
            <div className="clio-start-state">
              <RobotOutlined />
              <Typography.Title level={4}>What should Clio work on?</Typography.Title>
            </div>
          )}
        </div>

        <div className="clio-composer">
          <Input.TextArea
            value={draft}
            autoSize={{ minRows: 2, maxRows: 6 }}
            disabled={!activeId || !status.data?.healthy || sendMessage.isPending}
            placeholder={
              status.data?.healthy
                ? 'Ask Clio to draft, research, summarize, or prepare an artifact...'
                : 'Clio will be available once the private runtime is connected.'
            }
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={(event) => {
              if (event.shiftKey) return;
              event.preventDefault();
              submit();
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            disabled={!canSend}
            loading={sendMessage.isPending}
            onClick={submit}
          >
            Send
          </Button>
        </div>
      </main>

      <aside className="clio-artifact-panel" aria-label="Clio artifacts">
        <div className="clio-artifact-head">
          <FileTextOutlined />
          <strong>Artifacts</strong>
        </div>
        {selectedArtifact ? (
          <div className="clio-artifact-view">
            <div className="clio-artifact-list">
              {artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  className={artifact.id === selectedArtifact.id ? 'is-active' : ''}
                  type="button"
                  onClick={() => setActiveArtifactId(artifact.id)}
                >
                  <span>{artifact.title}</span>
                  <small>{artifact.kind}</small>
                </button>
              ))}
            </div>
            <div className="clio-artifact-body">
              <header>
                <Typography.Title level={4}>{selectedArtifact.title}</Typography.Title>
                <Typography.Text type="secondary">{selectedArtifact.kind}</Typography.Text>
              </header>
              <pre>{selectedArtifact.bodyText ?? 'Artifact content is stored outside text view.'}</pre>
            </div>
          </div>
        ) : (
          <div className="clio-artifact-empty">
            <FileTextOutlined />
            <span>Artifacts created by Clio will open here.</span>
          </div>
        )}
      </aside>
    </section>
  );
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}

function relativeTime(value: string): string {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}
