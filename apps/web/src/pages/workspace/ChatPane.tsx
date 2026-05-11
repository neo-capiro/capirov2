import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SendOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Empty, Input, Skeleton, Typography } from 'antd';
import { useApi } from '../../lib/use-api.js';
import type { ClioMessage, SessionWithMessages } from './types.js';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface ChatPaneProps {
  sessionId: string | null;
}

/**
 * Right-pane chat view. Renders the active session's history and lets the
 * user post the next turn. On send we optimistically append the user message
 * to the rendered list, then invalidate the cache once the assistant reply
 * lands so the canonical server-side ordering wins. No streaming yet —
 * Phase 2 adds Server-Sent Events for token-by-token render.
 */
export function ChatPane({ sessionId }: ChatPaneProps) {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const [draft, setDraft] = useState('');
  // Used to optimistically render the user's message while the assistant
  // reply is in flight. Cleared as soon as the cache rehydrates.
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const session = useQuery<SessionWithMessages>({
    queryKey: ['clio', 'session', sessionId],
    queryFn: async () =>
      (await api.get<SessionWithMessages>(`/api/clio/sessions/${sessionId}`)).data,
    enabled: Boolean(sessionId),
  });

  const sendMessage = useMutation({
    mutationFn: async (content: string) =>
      (
        await api.post<SessionWithMessages>(`/api/clio/sessions/${sessionId}/messages`, {
          content,
        })
      ).data,
    onMutate: (content) => {
      setPendingUserMessage(content);
      setDraft('');
    },
    onSuccess: (updated) => {
      qc.setQueryData(['clio', 'session', sessionId], updated);
      qc.invalidateQueries({ queryKey: ['clio', 'sessions'] });
      setPendingUserMessage(null);
    },
    onError: () => {
      setPendingUserMessage(null);
      message.error('Failed to send. Try again.');
    },
  });

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.data?.messages.length, pendingUserMessage]);

  if (!sessionId) {
    return (
      <div className="clio-chat-pane clio-chat-pane--empty">
        <Empty description="Pick a session, or start a new one." />
      </div>
    );
  }

  if (session.isLoading) {
    return (
      <div className="clio-chat-pane">
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  const messages = session.data?.messages ?? [];
  const handleSend = () => {
    const value = draft.trim();
    if (!value || sendMessage.isPending) return;
    sendMessage.mutate(value);
  };

  return (
    <div className="clio-chat-pane">
      <div className="clio-chat-pane__header">
        <Title level={4} ellipsis style={{ margin: 0 }}>
          {session.data?.title ?? 'Session'}
        </Title>
        <Text type="secondary">{session.data?.model}</Text>
      </div>

      <div className="clio-chat-pane__messages">
        {messages.length === 0 && !pendingUserMessage ? (
          <Empty
            description="Send a message to get started."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {pendingUserMessage ? (
              <MessageBubble
                message={{
                  id: 'pending-user',
                  role: 'user',
                  content: pendingUserMessage,
                  createdAt: new Date().toISOString(),
                  inputTokens: null,
                  outputTokens: null,
                  stopReason: null,
                }}
              />
            ) : null}
            {sendMessage.isPending ? (
              <div className="clio-chat-pane__pending-assistant">
                <Text type="secondary">Clio is thinking…</Text>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <div className="clio-chat-pane__composer">
        <TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={(e) => {
            // Submit on Enter; allow Shift+Enter for newlines, matching most
            // chat surfaces (Slack, Discord, ChatGPT).
            if (!e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask Clio anything…"
          autoSize={{ minRows: 2, maxRows: 8 }}
          disabled={sendMessage.isPending}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={sendMessage.isPending}
          disabled={draft.trim().length === 0}
          onClick={handleSend}
        >
          Send
        </Button>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ClioMessage }) {
  // System/tool rows are technically renderable but Phase 1 hides them — the
  // agent loop doesn't produce them yet, and showing raw tool plumbing would
  // be confusing before the loop is in place.
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  const isUser = message.role === 'user';
  return (
    <div className={`clio-message clio-message--${isUser ? 'user' : 'assistant'}`}>
      <div className="clio-message__bubble">
        <Text style={{ whiteSpace: 'pre-wrap' }}>{message.content}</Text>
      </div>
    </div>
  );
}
