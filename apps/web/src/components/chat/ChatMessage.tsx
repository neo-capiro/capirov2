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

function renderMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Fenced code blocks (must come before inline code)
  html = html.replace(/```(?:\w+\n)?([\s\S]*?)```/g, (_match, code: string) => {
    return `<pre class="chat-md-pre"><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="chat-md-code">$1</code>');

  // Bold
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h4 class="chat-md-h">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="chat-md-h">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 class="chat-md-h">$1</h2>');

  // Numbered and bullet list items → wrap consecutive ones in <ul>/<ol>
  html = html.replace(/^(\d+)\. (.+)$/gm, '<li data-ol="1">$2</li>');
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li data-ol> in <ol>
  html = html.replace(/(<li data-ol="1">.*?<\/li>\n?)+/gs, (match) => {
    const items = match.replace(/ data-ol="1"/g, '');
    return `<ol class="chat-md-list">${items}</ol>`;
  });

  // Wrap remaining consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>\n?)+/gs, (match) => {
    return `<ul class="chat-md-list">${match}</ul>`;
  });

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr class="chat-md-hr">');

  // Double newlines → paragraph breaks
  html = html.replace(/\n\n+/g, '</p><p class="chat-md-p">');

  // Single newlines → <br>
  html = html.replace(/\n/g, '<br>');

  // Wrap in <p> if not already a block element
  if (html && !/^<(h[1-6]|ul|ol|pre|hr|p)/.test(html)) {
    html = `<p class="chat-md-p">${html}</p>`;
  }

  return html;
}
