import { useMemo, useState, type MouseEvent } from 'react';
import { Alert, Drawer, Tag, Tooltip, Typography } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import type { ClioCitation, ClioVerification } from './chat-store.js';
import clioBubbleImage from '../../assets/chat/clio-bubble.png';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  citations?: ClioCitation[];
  verification?: ClioVerification;
}

export function ChatMessage({
  role,
  content,
  isStreaming,
  citations,
  verification,
}: ChatMessageProps) {
  const isUser = role === 'user';
  const [activeCitation, setActiveCitation] = useState<ClioCitation | null>(null);
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard?.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const citationMap = useMemo(() => {
    const map = new Map<number, ClioCitation>();
    for (const c of citations ?? []) map.set(c.n, c);
    return map;
  }, [citations]);

  const html = useMemo(() => renderMarkdown(content, citationMap), [content, citationMap]);

  // Event delegation: clicking a rendered [N] citation chip opens the drawer.
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const el = (event.target as HTMLElement).closest('[data-cite]');
    if (!el) return;
    const n = Number(el.getAttribute('data-cite'));
    const citation = citationMap.get(n);
    if (citation) setActiveCitation(citation);
  };

  return (
    <div className={`chat-msg chat-msg--${role}`}>
      {!isUser && (
        <div className="chat-msg-avatar" aria-hidden="true">
          <img src={clioBubbleImage} alt="" className="chat-msg-avatar-image" />
        </div>
      )}
      <div className="chat-msg-bubble">
        {isUser ? (
          <span className="chat-msg-text">{content}</span>
        ) : (
          <div
            className="chat-msg-markdown"
            onClick={handleClick}
            // Content is AI-generated, not from user input
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        {!isUser && content !== '' && !isStreaming && (
          <button
            type="button"
            className="chat-msg-copy"
            aria-label="Copy message"
            onClick={handleCopy}
            style={{
              marginTop: 6,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: '#1677ff',
              padding: 0,
              opacity: 0.7,
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        )}
        {!isUser && verification && verification.totalCount > 0 && (
          <div className="chat-msg-verification" style={{ marginTop: 8 }}>
            {verification.confidence && (
              <div style={{ marginBottom: 6 }}>
                <Tag
                  color={
                    verification.confidence.level === 'high'
                      ? 'green'
                      : verification.confidence.level === 'medium'
                        ? 'gold'
                        : verification.confidence.level === 'low'
                          ? 'red'
                          : 'default'
                  }
                >
                  {verification.confidence.label}
                </Tag>
              </div>
            )}
            {verification.lowConfidence ? (
              <Alert
                type="warning"
                showIcon
                message={`Low confidence — ${verification.unsupportedCount} of ${verification.totalCount} claims aren't backed by the cited sources.`}
              />
            ) : verification.unsupportedCount > 0 ? (
              <Alert
                type="info"
                showIcon
                message={`${verification.unsupportedCount} of ${verification.totalCount} claims couldn't be tied to a source.`}
              />
            ) : (
              <Typography.Text type="success" style={{ fontSize: 12 }}>
                ✓ {verification.totalCount} claims checked against sources
              </Typography.Text>
            )}
            {verification.claims.some((c) => !c.supported) && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {verification.claims
                  .filter((c) => !c.supported)
                  .map((claim, i) => (
                    <li key={i} style={{ fontSize: 12, marginBottom: 2 }}>
                      <Tooltip title="Not supported by the retrieved sources">
                        <span
                          style={{
                            textDecoration: 'underline',
                            textDecorationStyle: 'wavy',
                            textDecorationColor: '#faad14',
                          }}
                        >
                          {claim.claim}
                        </span>
                      </Tooltip>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
        {isStreaming && <span className="chat-msg-cursor" aria-hidden="true" />}
      </div>

      <Drawer
        className="chat-citation-drawer"
        title="Source"
        placement="right"
        width={Math.min(420, typeof window !== 'undefined' ? window.innerWidth - 24 : 420)}
        open={Boolean(activeCitation)}
        onClose={() => setActiveCitation(null)}
        destroyOnClose
      >
        {activeCitation && (
          <div className="chat-citation-detail">
            <Tag color="blue">{citationTypeLabel(activeCitation.type)}</Tag>
            <Typography.Title level={5} style={{ marginTop: 12 }}>
              {activeCitation.title}
            </Typography.Title>
            {activeCitation.snippet && (
              <Typography.Paragraph type="secondary">{activeCitation.snippet}</Typography.Paragraph>
            )}
            {activeCitation.url && (
              <Typography.Link href={activeCitation.url} target="_blank" rel="noopener noreferrer">
                Open source <ExportOutlined />
              </Typography.Link>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function citationTypeLabel(type: string): string {
  return type
    .split('_')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Replace `[N]` markers that map to a real citation with clickable chips. */
function renderCitations(html: string, citationMap: Map<number, ClioCitation>): string {
  if (citationMap.size === 0) return html;
  return html.replace(/\[(\d{1,3})\]/g, (whole, digits: string) => {
    const n = Number(digits);
    if (!citationMap.has(n)) return whole;
    const style =
      'color:#1677ff;cursor:pointer;background:none;border:none;padding:0 1px;' +
      'font:inherit;font-size:0.85em;font-weight:600;vertical-align:super';
    return `<button type="button" class="chat-citation" data-cite="${n}" title="View source ${n}" style="${style}">[${n}]</button>`;
  });
}

/** Inline spans only (bold, italic, code, links) — operates on escaped text. */
function renderInline(text: string, citationMap: Map<number, ClioCitation>): string {
  const withSpans = text
    .replace(/`([^`\n]+)`/g, '<code class="chat-md-code">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    // [label](http…) — only http(s) to avoid javascript: injection
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
  // Citation chips run last so they don't clobber markdown links (which require
  // a trailing "(url)" that a bare [N] marker never has).
  return renderCitations(withSpans, citationMap);
}

/**
 * Block-aware markdown → HTML for assistant bubbles.
 *
 * Spacing comes ONLY from block-element CSS margins — we never emit a <br> per
 * newline (the previous renderer did, which produced erratic double spacing
 * after headings and between list items). Blocks are separated by blank lines;
 * consecutive list lines group into one <ul>/<ol>; everything else is a <p>.
 */
function renderMarkdown(text: string, citationMap: Map<number, ClioCitation> = new Map()): string {
  const escaped = escapeHtml((text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'));

  // Fenced code blocks first — pull them out so their contents aren't parsed.
  const codeBlocks: string[] = [];
  const withoutCode = escaped.replace(/```(?:\w+\n)?([\s\S]*?)```/g, (_m, code: string) => {
    codeBlocks.push(`<pre class="chat-md-pre"><code>${code.replace(/\n+$/, '')}</code></pre>`);
    return ` CODE${codeBlocks.length - 1} `;
  });

  const lines = withoutCode.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p class="chat-md-p">${renderInline(para.join(' '), citationMap)}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it) => `<li>${renderInline(it, citationMap)}</li>`).join('');
      out.push(`<${list.type} class="chat-md-list">${items}</${list.type}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    // Code-block placeholder is its own block.
    const codeMatch = /^ CODE(\d+) $/.exec(trimmed);
    if (codeMatch) {
      flushPara();
      flushList();
      out.push(codeBlocks[Number(codeMatch[1])]!);
      continue;
    }

    if (!trimmed) {
      flushPara();
      flushList();
      continue;
    }
    if (/^---+$/.test(trimmed)) {
      flushPara();
      flushList();
      out.push('<hr class="chat-md-hr" />');
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      flushList();
      out.push(`<div class="chat-md-h">${renderInline(heading[2]!, citationMap)}</div>`);
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushPara();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(bullet[1]!);
      continue;
    }
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushPara();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(numbered[1]!);
      continue;
    }
    // Plain text — accumulate into the current paragraph (soft-wrap join).
    flushList();
    para.push(trimmed);
  }
  flushPara();
  flushList();

  return out.join('');
}
