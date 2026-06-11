import { useEffect, useRef, useState } from 'react';
import {
  BulbOutlined,
  CheckCircleFilled,
  DownOutlined,
  LoadingOutlined,
  RightOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

export interface TrustStep {
  tool: string;
  label: string;
  detail?: string;
  count?: number;
  confidence?: 'high' | 'medium' | 'low';
  status: 'running' | 'done' | 'error';
}

interface ThoughtProcessProps {
  /** Classified intent for this turn (the "plan"). */
  intent?: string | null;
  /** Retrieval tier (fast/deep). */
  tier?: 'fast' | 'deep' | null;
  /** Ordered steps: tool calls + their results. */
  steps: TrustStep[];
  /** Streamed plan steps shown up front before tools run (P2-1). */
  planSteps?: string[];
  /** True while the assistant turn is still streaming. */
  isStreaming: boolean;
  /**
   * Accumulated model reasoning for the in-flight turn (deep-tier `thinking`
   * SSE deltas). Ephemeral — never persisted, absent after a reload.
   */
  reasoningText?: string;
}

const INTENT_LABELS: Record<string, string> = {
  query_intelligence: 'Researching federal intelligence',
  query_clients: 'Reviewing client records',
  query_engagement: 'Reviewing meetings & outreach',
  query_workflow: 'Checking workflows',
  generate_draft: 'Drafting',
  generate_briefing: 'Building a briefing',
  navigate: 'Navigating',
  general_question: 'Working on your question',
};

function confidenceDot(c?: 'high' | 'medium' | 'low'): string {
  if (c === 'high') return 'chat-tp-dot--high';
  if (c === 'low') return 'chat-tp-dot--low';
  return 'chat-tp-dot--medium';
}

/**
 * Inline "thought process" / sources panel attached to an assistant message —
 * the trust layer most advanced chats show. Live status while streaming,
 * collapses to a one-line summary when done, expandable to the full step list
 * with data sources and their confidence.
 */
export function ThoughtProcess({
  intent,
  tier,
  steps,
  planSteps,
  isStreaming,
  reasoningText,
}: ThoughtProcessProps) {
  const [expanded, setExpanded] = useState(false);
  // Reasoning accordion: collapsed by default; live-appends while streaming.
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const reasoningBodyRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the reasoning pane to the bottom while text is streaming in.
  useEffect(() => {
    if (!reasoningOpen || !isStreaming) return;
    const el = reasoningBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reasoningText, reasoningOpen, isStreaming]);

  // Nothing to show until the agent does something beyond plain text.
  if (!isStreaming && steps.length === 0 && !reasoningText) return null;

  const toolCount = steps.length;
  const sourceCount = steps.reduce((acc, s) => acc + (typeof s.count === 'number' ? s.count : 0), 0);
  const planLabel = (intent && INTENT_LABELS[intent]) || 'Working';
  const runningStep = steps.find((s) => s.status === 'running');

  // Header text: live status while streaming, summary when done.
  let headerText: string;
  if (isStreaming) {
    headerText = runningStep ? runningStep.label : `${planLabel}…`;
  } else if (toolCount === 0) {
    headerText = 'Answered directly';
  } else {
    const parts = [`Used ${toolCount} tool${toolCount === 1 ? '' : 's'}`];
    if (sourceCount > 0) parts.push(`${sourceCount} source${sourceCount === 1 ? '' : 's'}`);
    headerText = parts.join(' · ');
  }

  return (
    <div className={`chat-tp${isStreaming ? ' chat-tp--live' : ''}`}>
      <button
        type="button"
        className="chat-tp-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="chat-tp-header-icon" aria-hidden="true">
          {isStreaming ? <LoadingOutlined spin /> : <ThunderboltOutlined />}
        </span>
        <span className="chat-tp-header-text">{headerText}</span>
        {tier === 'deep' && <span className="chat-tp-tier">deep</span>}
        <span className="chat-tp-chevron" aria-hidden="true">
          {expanded ? <DownOutlined /> : <RightOutlined />}
        </span>
      </button>

      {expanded && (
        <div className="chat-tp-body">
          {reasoningText ? (
            <div className="chat-tp-reasoning">
              <button
                type="button"
                className="chat-tp-reasoning-header"
                onClick={() => setReasoningOpen((v) => !v)}
                aria-expanded={reasoningOpen}
              >
                <span className="chat-tp-reasoning-icon" aria-hidden="true">
                  <BulbOutlined />
                </span>
                <span className="chat-tp-reasoning-label">Reasoning</span>
                <span className="chat-tp-chevron" aria-hidden="true">
                  {reasoningOpen ? <DownOutlined /> : <RightOutlined />}
                </span>
              </button>
              {reasoningOpen && (
                <div className="chat-tp-reasoning-body" ref={reasoningBodyRef}>
                  {reasoningText}
                </div>
              )}
            </div>
          ) : null}
          {planSteps && planSteps.length > 0 ? (
            <div className="chat-tp-plan">
              <span className="chat-tp-plan-label">Plan</span>
              <ol className="chat-tp-plan-steps">
                {planSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          ) : intent ? (
            <div className="chat-tp-plan">
              <span className="chat-tp-plan-label">Plan</span>
              <span>{planLabel}</span>
            </div>
          ) : null}
          <ol className="chat-tp-steps">
            {steps.map((step, i) => (
              <li key={`${step.tool}-${i}`} className={`chat-tp-step chat-tp-step--${step.status}`}>
                <span className="chat-tp-step-icon" aria-hidden="true">
                  {step.status === 'running' ? (
                    <LoadingOutlined spin />
                  ) : step.status === 'error' ? (
                    <span className="chat-tp-step-err">!</span>
                  ) : (
                    <CheckCircleFilled />
                  )}
                </span>
                <span className="chat-tp-step-main">
                  <span className="chat-tp-step-label">{step.label}</span>
                  {step.detail && <span className="chat-tp-step-detail">{step.detail}</span>}
                </span>
                {step.confidence && step.status === 'done' && (
                  <span
                    className={`chat-tp-dot ${confidenceDot(step.confidence)}`}
                    title={`Confidence: ${step.confidence}`}
                    aria-label={`Confidence ${step.confidence}`}
                  />
                )}
              </li>
            ))}
            {isStreaming && steps.every((s) => s.status !== 'running') && (
              <li className="chat-tp-step chat-tp-step--running">
                <span className="chat-tp-step-icon" aria-hidden="true"><LoadingOutlined spin /></span>
                <span className="chat-tp-step-main">
                  <span className="chat-tp-step-label">Composing answer…</span>
                </span>
              </li>
            )}
          </ol>
          <p className="chat-tp-footnote">
            Clio grounds answers in Capiro data and the sources above. Verify specifics before high-stakes use.
          </p>
        </div>
      )}
    </div>
  );
}
