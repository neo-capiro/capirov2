import { useState, type KeyboardEvent } from 'react';
import { ExperimentOutlined, SendOutlined } from '@ant-design/icons';
import { Button } from 'antd';

interface ChatInputProps {
  disabled?: boolean;
  onSend: (content: string) => void;
  writeMode?: boolean;
  onToggleWriteMode?: () => void;
  researchMode?: boolean;
  onToggleResearchMode?: () => void;
  researchAwaitingAnswers?: boolean;
}

export function ChatInput({
  disabled,
  onSend,
  writeMode = false,
  onToggleWriteMode,
  researchMode = false,
  onToggleResearchMode,
  researchAwaitingAnswers = false,
}: ChatInputProps) {
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

  const placeholder = researchMode
    ? researchAwaitingAnswers
      ? 'Answer Clio’s questions (or say “go ahead”) to start the research…'
      : 'Describe what to research — Clio will plan it and ask a few questions…'
    : writeMode
      ? 'Write mode: describe what to update on this page (subject/body/field)…'
      : 'Ask Clio… (Enter to send, Shift+Enter for newline)';

  return (
    <div className="chat-input-row">
      <div className="chat-composer">
        <textarea
          className={`chat-input-textarea${writeMode ? ' chat-input-textarea--write' : ''}${
            researchMode ? ' chat-input-textarea--research' : ''
          }`}
          value={value}
          placeholder={placeholder}
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
        <div className="chat-composer-actions">
          {onToggleResearchMode ? (
            <button
              type="button"
              className={`chat-mode-toggle chat-research-toggle${researchMode ? ' is-active' : ''}`}
              onClick={onToggleResearchMode}
              disabled={disabled}
              aria-label={researchMode ? 'Disable deep research' : 'Enable deep research'}
              title={researchMode ? 'Deep research on' : 'Deep research'}
            >
              <ExperimentOutlined />
              <span>Research</span>
            </button>
          ) : null}
          {onToggleWriteMode ? (
            <button
              type="button"
              className={`chat-mode-toggle chat-write-toggle${writeMode ? ' is-active' : ''}`}
              onClick={onToggleWriteMode}
              disabled={disabled}
              aria-label={writeMode ? 'Disable write mode' : 'Enable write mode'}
              title={writeMode ? 'Write mode on' : 'Write mode off'}
            >
              Write
            </button>
          ) : null}
          <span className="chat-composer-spacer" />
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
      </div>
    </div>
  );
}
