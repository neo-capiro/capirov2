import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SendOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Empty, Input, Skeleton, Typography } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApi } from '../../lib/use-api.js';
import { QuestionModal } from './QuestionModal.js';
import { parseAssistantMessage, type CapiroQuestion } from './question-block.js';
import type { ClioMessage, SessionWithMessages } from './types.js';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface ChatPaneProps {
  sessionId: string | null;
  // Called once per successful round-trip so siblings (e.g. the artifact
  // panel) can refetch. Optional — the chat pane functions fine without
  // anyone listening.
  onAssistantReply?: () => void;
}

/**
 * Right-pane chat view. Renders the active session's history and lets the
 * user post the next turn. On send we optimistically append the user message
 * to the rendered list, then invalidate the cache once the assistant reply
 * lands so the canonical server-side ordering wins. No streaming yet —
 * Phase 2 adds Server-Sent Events for token-by-token render.
 */
export function ChatPane({ sessionId, onAssistantReply }: ChatPaneProps) {
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
      onAssistantReply?.();
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

  // Detect a clarifying question from the most recent assistant turn.
  // The modal is suppressed once the user has replied (we look at
  // whether the assistant message is still the last one in history).
  // Local "dismissed" state lets the user close the modal without
  // answering and still come back to it via the visible question card
  // in the chat — the assistant message itself stays rendered.
  const [dismissedQuestionForMessageId, setDismissedQuestionForMessageId] = useState<string | null>(
    null,
  );
  const pendingQuestion = useMemo<{ question: CapiroQuestion; messageId: string } | null>(() => {
    const msgs = session.data?.messages ?? [];
    if (msgs.length === 0) return null;
    const last = msgs[msgs.length - 1];
    if (last.role !== 'assistant' || !last.content) return null;
    const parsed = parseAssistantMessage(last.content);
    if (!parsed.question) return null;
    if (dismissedQuestionForMessageId === last.id) return null;
    return { question: parsed.question, messageId: last.id };
  }, [session.data?.messages, dismissedQuestionForMessageId]);

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

      {pendingQuestion ? (
        <QuestionModal
          question={pendingQuestion.question}
          open
          onSubmit={(answer) => {
            // Send the answer as the next user turn; the agent picks it
            // up on the following round-trip.
            setDismissedQuestionForMessageId(pendingQuestion.messageId);
            sendMessage.mutate(answer);
          }}
          onCancel={() => setDismissedQuestionForMessageId(pendingQuestion.messageId)}
        />
      ) : null}
    </div>
  );
}

function MessageBubble({ message }: { message: ClioMessage }) {
  // System/tool rows are technically renderable but the UI hides them —
  // showing raw tool plumbing is confusing and the agent loop already
  // surfaces tool-call summaries in the assistant text.
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  const isUser = message.role === 'user';
  const content = message.content ?? '';
  // Strip any `capiro-question` fence from the rendered prose — the
  // modal owns that block. We still show whatever text the model put
  // before the fence (the prompt asks for none, but the model is free
  // to add a one-liner like "Got it — one more thing:").
  const visibleProse = isUser ? content : parseAssistantMessage(content).prose;
  return (
    <div className={`clio-message clio-message--${isUser ? 'user' : 'assistant'}`}>
      <div className="clio-message__bubble">
        {isUser ? (
          // User text is whatever the human typed — render as plain
          // pre-wrap text. Treating it as markdown would mis-render
          // anything containing #, *, _, etc. that wasn't intended as
          // formatting.
          <Text style={{ whiteSpace: 'pre-wrap' }}>{visibleProse}</Text>
        ) : visibleProse.length === 0 ? (
          // The model emitted the question block alone, with no
          // surrounding prose. Show a placeholder so the assistant
          // turn isn't a blank bubble — the modal carries the actual
          // question.
          <Text type="secondary" italic>
            (asking a clarifying question — see the modal)
          </Text>
        ) : (
          <div className="clio-message__markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{visibleProse}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
