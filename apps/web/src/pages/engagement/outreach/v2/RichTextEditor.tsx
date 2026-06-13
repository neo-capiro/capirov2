// A self-contained WYSIWYG editor (contentEditable + execCommand toolbar) for
// the Generate & Review body. Output is sanitized HTML; recipients receive it
// as a real HTML email (the Graph send body is set to contentType:'HTML' for
// HTML drafts). No external editor dependency.
//
// Sanitization runs on every emit and on paste, so pasted Word/web markup and
// any injected script/style/handlers are stripped to a safe allowlist before
// the HTML ever reaches state or the send pipeline.

import { useEffect, useRef, type ClipboardEvent, type ReactNode } from 'react';
import {
  BoldOutlined,
  ClearOutlined,
  ItalicOutlined,
  LinkOutlined,
  OrderedListOutlined,
  UnderlineOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { sanitizeHtml } from './richtext.js';

function escapeText(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Sync an external value in only when the editor isn't focused, so a
  // Regenerate (which replaces the draft) lands without stomping the caret
  // mid-typing. While focused, the user's own keystrokes are the source.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    // Sanitize on the way IN too: the incoming value may be unsanitized AI/
    // markdown output or a rehydrated draft, and it goes straight into the DOM.
    const safe = sanitizeHtml(value || '');
    if (el.innerHTML !== safe) el.innerHTML = safe;
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const raw = el.innerHTML;
    const clean = sanitizeHtml(raw);
    // Only rewrite the DOM if sanitizing actually changed something (pasted or
    // injected markup) — avoids resetting the caret on ordinary typing.
    if (clean !== raw) el.innerHTML = clean;
    onChange(clean);
  };

  const exec = (command: string, arg?: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand('styleWithCSS', false, 'false'); // prefer tags (<b>) over inline styles
    document.execCommand(command, false, arg);
    emit();
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const fragment = html ? sanitizeHtml(html) : escapeText(text);
    document.execCommand('insertHTML', false, fragment);
    emit();
  };

  const addLink = () => {
    const url = window.prompt('Link URL (https:// or mailto:)');
    if (!url || !/^(https?:|mailto:)/i.test(url)) return;
    exec('createLink', url);
  };

  return (
    <div className="ov2-rte">
      <div className="ov2-rte-toolbar">
        <ToolBtn label="Bold" onClick={() => exec('bold')}>
          <BoldOutlined />
        </ToolBtn>
        <ToolBtn label="Italic" onClick={() => exec('italic')}>
          <ItalicOutlined />
        </ToolBtn>
        <ToolBtn label="Underline" onClick={() => exec('underline')}>
          <UnderlineOutlined />
        </ToolBtn>
        <span className="ov2-rte-sep" />
        <ToolBtn label="Heading" onClick={() => exec('formatBlock', 'h3')}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>H</span>
        </ToolBtn>
        <ToolBtn label="Bulleted list" onClick={() => exec('insertUnorderedList')}>
          <UnorderedListOutlined />
        </ToolBtn>
        <ToolBtn label="Numbered list" onClick={() => exec('insertOrderedList')}>
          <OrderedListOutlined />
        </ToolBtn>
        <ToolBtn label="Add link" onClick={addLink}>
          <LinkOutlined />
        </ToolBtn>
        <span className="ov2-rte-sep" />
        <ToolBtn label="Clear formatting" onClick={() => exec('removeFormat')}>
          <ClearOutlined />
        </ToolBtn>
      </div>
      <div
        ref={ref}
        className="ov2-rte-area"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder ?? ''}
        onInput={emit}
        onBlur={emit}
        onPaste={onPaste}
      />
    </div>
  );
}

function ToolBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="ov2-rte-btn"
      title={label}
      aria-label={label}
      // Keep the editor's selection — clicking a toolbar button must not blur it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
