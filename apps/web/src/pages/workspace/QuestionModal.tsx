import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Input, Modal, Radio, Space, Typography } from 'antd';
import type { CapiroQuestion } from './question-block.js';

const { Text } = Typography;
const { TextArea } = Input;

interface QuestionModalProps {
  question: CapiroQuestion;
  open: boolean;
  onSubmit: (answer: string) => void;
  onCancel: () => void;
}

/**
 * Modal that renders a clarifying question from the agent.
 *
 *   - Radio (single-select) when options exist and !multi.
 *   - Checkbox (multi-select) when options exist and multi.
 *   - Text only when no options or allowFreeText was set and the user
 *     toggles into a custom answer.
 *
 * Submitting closes the modal and emits a plain-text answer back to
 * the chat as the next user message — the agent picks up the answer
 * on its next turn and continues.
 */
export function QuestionModal({ question, open, onSubmit, onCancel }: QuestionModalProps) {
  const { options, allowFreeText, multi } = question;
  const hasOptions = (options?.length ?? 0) > 0;

  const [selection, setSelection] = useState<string | undefined>(undefined);
  const [selections, setSelections] = useState<string[]>([]);
  const [freeText, setFreeText] = useState('');
  const [showFreeText, setShowFreeText] = useState(!hasOptions);

  // Reset internal state when the modal reopens with a new question
  // (e.g. after the user submitted the previous one and the agent
  // asked another). Without this, the second modal starts pre-populated
  // with the previous answer.
  useEffect(() => {
    if (open) {
      setSelection(undefined);
      setSelections([]);
      setFreeText('');
      setShowFreeText(!hasOptions);
    }
  }, [open, hasOptions, question.question]);

  const canSubmit = useMemo(() => {
    if (showFreeText) return freeText.trim().length > 0;
    if (multi) return selections.length > 0;
    return Boolean(selection);
  }, [showFreeText, freeText, multi, selections, selection]);

  const submit = () => {
    if (!canSubmit) return;
    const answer = showFreeText
      ? freeText.trim()
      : multi
        ? selections.join(', ')
        : (selection ?? '');
    onSubmit(answer);
  };

  return (
    <Modal
      title="Clio is asking"
      open={open}
      onCancel={onCancel}
      onOk={submit}
      okButtonProps={{ disabled: !canSubmit }}
      okText="Send answer"
      cancelText="Skip"
      destroyOnClose
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Text>{question.question}</Text>

        {hasOptions && !showFreeText ? (
          multi ? (
            <Checkbox.Group
              value={selections}
              onChange={(v) => setSelections(v as string[])}
              options={(options ?? []).map((o) => ({ label: o, value: o }))}
            />
          ) : (
            <Radio.Group
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              {(options ?? []).map((o) => (
                <Radio key={o} value={o}>
                  {o}
                </Radio>
              ))}
            </Radio.Group>
          )
        ) : null}

        {showFreeText ? (
          <TextArea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder="Type your answer…"
            autoFocus
          />
        ) : null}

        {hasOptions && allowFreeText ? (
          <Button type="link" size="small" onClick={() => setShowFreeText((v) => !v)}>
            {showFreeText ? 'Choose from options instead' : 'Type my own answer'}
          </Button>
        ) : null}
      </Space>
    </Modal>
  );
}
