import clioBubbleImage from '../../assets/chat/clio-bubble.png';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export function ChatMessage({ role, content, isStreaming }: ChatMessageProps) {
  const isUser = role === 'user';
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
            // Content is AI-generated, not from user input
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        )}
        {isStreaming && <span className="chat-msg-cursor" aria-hidden="true" />}
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline spans only (bold, italic, code, links) — operates on escaped text. */
function renderInline(text: string): string {
  return text
    .replace(/`([^`\n]+)`/g, '<code class="chat-md-code">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    // [label](http…) — only http(s) to avoid javascript: injection
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

/**
 * Block-aware markdown → HTML for assistant bubbles.
 *
 * Spacing comes ONLY from block-element CSS margins — we never emit a <br> per
 * newline (the previous renderer did, which produced erratic double spacing
 * after headings and between list items). Blocks are separated by blank lines;
 * consecutive list lines group into one <ul>/<ol>; everything else is a <p>.
 */
function renderMarkdown(text: string): string {
  const escaped = escapeHtml((text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'));

  // Fenced code blocks first — pull them out so their contents aren't parsed.
  const codeBlocks: string[] = [];
  const withoutCode = escaped.replace(/```(?:\w+\n)?([\s\S]*?)```/g, (_m, code: string) => {
    codeBlocks.push(`<pre class="chat-md-pre"><code>${code.replace(/\n+$/,'')}</code></pre>`);
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });

  const lines = withoutCode.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p class="chat-md-p">${renderInline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it) => `<li>${renderInline(it)}</li>`).join('');
      out.push(`<${list.type} class="chat-md-list">${items}</${list.type}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    // Code-block placeholder is its own block.
    const codeMatch = /^\u0000CODE(\d+)\u0000$/.exec(trimmed);
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
      out.push(`<div class="chat-md-h">${renderInline(heading[2]!)}</div>`);
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
