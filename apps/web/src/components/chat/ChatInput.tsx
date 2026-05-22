import { useState, type KeyboardEvent } from 'react';
import { SendOutlined } from '@ant-design/icons';
import { Button } from 'antd';

interface ChatInputProps {
  disabled?: boolean;
  onSend: (content: string) => void;
}

export function ChatInput({ disabled, onSend }: ChatInputProps) {
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
        className="chat-input-textarea"
        value={value}
        placeholder="Ask Capiro AI… (Enter to send, Shift+Enter for newline)"
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
