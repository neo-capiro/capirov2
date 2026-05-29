import { useState, type KeyboardEvent } from 'react';
import { SendOutlined } from '@ant-design/icons';
import { Button } from 'antd';

interface ChatInputProps {
  disabled?: boolean;
  onSend: (content: string) => void;
  writeMode?: boolean;
  onToggleWriteMode?: () => void;
}

export function ChatInput({ disabled, onSend, writeMode = false, onToggleWriteMode }: ChatInputProps) {
  const [value, setValue] = useState('');

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="chat-input-row">
      <textarea
        className={`chat-input-textarea${writeMode ? ' chat-input-textarea--write' : ''}`}
        value={value}
        placeholder={
          writeMode
            ? 'Write mode: describe what to update on this page (subject/body/field)…'
            : 'Ask Capiro AI… (Enter to send, Shift+Enter for newline)'
        }
        disabled={disabled}
        rows={1}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = 'auto';
          el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
        }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {onToggleWriteMode ? (
        <button
          type="button"
          className={`chat-write-toggle${writeMode ? ' is-active' : ''}`}
          onClick={onToggleWriteMode}
          disabled={disabled}
          aria-label={writeMode ? 'Disable write mode' : 'Enable write mode'}
          title={writeMode ? 'Write mode on' : 'Write mode off'}
        >
          Write
        </button>
      ) : null}
      <Button
        type="primary"
        shape="circle"
        icon={<SendOutlined />}
        disabled={disabled || !value.trim()}
        onClick={submit}
        className="chat-input-send"
        aria-label="Send message"
      />
    </div>
  );
}
