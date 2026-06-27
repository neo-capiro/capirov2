/**
 * Rich-text formatting toolbar (ported from the prototype's `RichTextToolbar`,
 * asset_07). Font family/size, B/I/U, alignment, lists, indent. Commands are
 * routed to the *active* controlled section editor via `runActiveCommand`
 * instead of the prototype's global `execCommand`, so formatting only ever
 * affects the section the caret is in.
 */
import type { CSSProperties } from 'react';
import { Icon } from '../kit.js';
import { runActiveCommand } from './rich-text.js';

const selStyle: CSSProperties = {
  fontSize: 11.5,
  border: '1px solid var(--border-1)',
  borderRadius: 4,
  padding: '3px 5px',
  fontFamily: 'var(--font-sans)',
  background: 'var(--bg-surface)',
  color: 'var(--ink-1)',
  cursor: 'pointer',
  outline: 'none',
};

function Divider() {
  return (
    <div
      style={{ width: 1, height: 16, background: 'var(--border-1)', margin: '0 3px', flex: 'none' }}
    />
  );
}

function ToolBtn({
  icon,
  label,
  cmd,
  val,
}: {
  icon: string;
  label: string;
  cmd: string;
  val?: string;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      // onMouseDown + preventDefault keeps the section editor's selection alive
      // (clicking the toolbar must not blur the caret).
      onMouseDown={(e) => {
        e.preventDefault();
        runActiveCommand(cmd, val);
      }}
      style={{
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        width: 26,
        height: 26,
        borderRadius: 4,
        color: 'var(--ink-2)',
        flex: 'none',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

export function RichTextToolbar() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '5px 14px',
        borderBottom: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        flexWrap: 'wrap',
        flex: 'none',
      }}
    >
      <select
        style={{ ...selStyle, minWidth: 80 }}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => runActiveCommand('fontName', e.target.value)}
        defaultValue=""
        aria-label="Font family"
      >
        <option value="">Default</option>
        <option value="Georgia, serif">Serif</option>
        <option value="system-ui, sans-serif">Sans</option>
        <option value="ui-monospace, monospace">Mono</option>
      </select>
      <select
        style={{ ...selStyle, width: 46, marginLeft: 4 }}
        onChange={(e) => runActiveCommand('fontSize', e.target.value)}
        defaultValue="3"
        aria-label="Font size"
      >
        <option value="1">10</option>
        <option value="2">11</option>
        <option value="3">12</option>
        <option value="4">14</option>
        <option value="5">18</option>
        <option value="6">24</option>
        <option value="7">36</option>
      </select>
      <Divider />
      <ToolBtn icon="Bold" label="Bold" cmd="bold" />
      <ToolBtn icon="Italic" label="Italic" cmd="italic" />
      <ToolBtn icon="Underline" label="Underline" cmd="underline" />
      <Divider />
      <ToolBtn icon="AlignLeft" label="Align left" cmd="justifyLeft" />
      <ToolBtn icon="AlignCenter" label="Align center" cmd="justifyCenter" />
      <ToolBtn icon="AlignRight" label="Align right" cmd="justifyRight" />
      <ToolBtn icon="AlignJustify" label="Justify" cmd="justifyFull" />
      <Divider />
      <ToolBtn icon="List" label="Bullet list" cmd="insertUnorderedList" />
      <ToolBtn icon="ListOrdered" label="Numbered list" cmd="insertOrderedList" />
      <ToolBtn icon="Indent" label="Indent" cmd="indent" />
      <ToolBtn icon="Outdent" label="Outdent" cmd="outdent" />
    </div>
  );
}
