import { useState } from 'react';
import { ExperimentOutlined } from '@ant-design/icons';

interface ResearchClarifyFormProps {
  questions: string[];
  disabled?: boolean;
  onSubmit: (answers: Record<string, string>, skipped: boolean) => void;
}

/**
 * Inline clarifying-questions form rendered inside the Clio chat (Claude-style):
 * one field per question, a primary "Run deep research" action, and a "Skip"
 * affordance that lets Clio proceed with its own assumptions. Answers are keyed
 * by question index to match the backend's clarify contract.
 */
export function ResearchClarifyForm({ questions, disabled, onSubmit }: ResearchClarifyFormProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const submit = () => {
    if (disabled) return;
    onSubmit(answers, false);
  };

  return (
    <div className="chat-clarify">
      <div className="chat-clarify-head">
        <ExperimentOutlined />
        <span>A few quick questions before I dig in</span>
      </div>
      <div className="chat-clarify-fields">
        {questions.map((q, i) => (
          <div className="chat-clarify-field" key={i}>
            <label className="chat-clarify-q" htmlFor={`clarify-${i}`}>
              {q}
            </label>
            <textarea
              id={`clarify-${i}`}
              className="chat-clarify-input"
              rows={1}
              disabled={disabled}
              value={answers[String(i)] ?? ''}
              placeholder="Optional"
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
              }}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [String(i)]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div className="chat-clarify-actions">
        <button type="button" className="chat-clarify-run" disabled={disabled} onClick={submit}>
          Run deep research
        </button>
        <button
          type="button"
          className="chat-clarify-skip"
          disabled={disabled}
          onClick={() => onSubmit({}, true)}
        >
          Skip — use your best judgment
        </button>
      </div>
    </div>
  );
}
