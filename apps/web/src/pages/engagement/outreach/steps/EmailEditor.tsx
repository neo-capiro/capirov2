import { useMemo, useState } from 'react';
import { App, Button, Col, Input, Row, Segmented, Select, Tooltip, Typography } from 'antd';
import { EditOutlined, EyeOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { useApi } from '../../../../lib/use-api.js';
import type { GeneratedEmail, WizardTone } from '../OutreachWizard.js';

interface EmailEditorProps {
  generatedEmails: GeneratedEmail[];
  selectedRecipientIdx: number;
  tone: WizardTone;
  clientId: string | null;
  selectedTemplateId: string | null;
  selectedInsights: string[];
  additionalContext: string;
  onEmailUpdate: (idx: number, patch: Partial<Pick<GeneratedEmail, 'subject' | 'body' | 'status'>>) => void;
  onSelectRecipient: (idx: number) => void;
  onToneChange: (tone: WizardTone) => void;
}

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'formal', label: 'Formal' },
  { value: 'concise', label: 'Concise' },
];

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function simpleMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br />');
}

export function EmailEditor({
  generatedEmails,
  selectedRecipientIdx,
  tone,
  clientId,
  selectedTemplateId,
  selectedInsights,
  additionalContext,
  onEmailUpdate,
  onSelectRecipient,
  onToneChange,
}: EmailEditorProps) {
  const api = useApi();
  const { message } = App.useApp();
  const [view, setView] = useState<'edit' | 'preview'>('edit');

  const email = generatedEmails[selectedRecipientIdx];
  const hasContent = Boolean(email?.subject || email?.body);

  const regenerate = useMutation({
    mutationFn: async () => {
      if (!email || !selectedTemplateId) throw new Error('No template selected');
      return (
        await api.post<{ results: Array<{ recipientId: string; subject: string; body: string }> }>(
          '/api/engagement/outreach/generate-batch',
          {
            clientId: clientId ?? undefined,
            templateId: selectedTemplateId,
            recipients: [email.recipient],
            insights: selectedInsights.length ? selectedInsights : undefined,
            additionalContext: additionalContext || undefined,
            tone,
          },
        )
      ).data;
    },
    onSuccess: (result) => {
      const match = result.results[0];
      if (match && (match.subject || match.body)) {
        onEmailUpdate(selectedRecipientIdx, {
          subject: match.subject,
          body: match.body,
          status: 'ready',
        });
        message.success('Email regenerated');
      }
    },
    onError: (err: unknown) => message.error(extractMessage(err)),
  });

  const wordCount = useMemo(() => countWords(email?.body ?? ''), [email?.body]);

  if (!email) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Typography.Text type="secondary">No email selected.</Typography.Text>
      </div>
    );
  }

  return (
    <div className="outreach-flow-stack">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Email Editor
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {email.recipient.name || email.recipient.email || 'Recipient'}{' '}
            {email.recipient.office ? `· ${email.recipient.office}` : ''}
          </Typography.Text>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {generatedEmails.length > 1 && (
            <Select
              size="small"
              value={selectedRecipientIdx}
              onChange={onSelectRecipient}
              style={{ width: 180 }}
              options={generatedEmails.map((e, idx) => ({
                value: idx,
                label: e.recipient.name || e.recipient.email || `Recipient ${idx + 1}`,
              }))}
            />
          )}
          <Segmented
            size="small"
            value={view}
            onChange={(v) => setView(v as 'edit' | 'preview')}
            options={[
              { value: 'edit', icon: <EditOutlined /> },
              { value: 'preview', icon: <EyeOutlined /> },
            ]}
          />
        </div>
      </div>

      <Row gutter={8} style={{ marginBottom: 12 }}>
        <Col>
          <Select
            size="small"
            value={tone}
            onChange={onToneChange}
            options={TONE_OPTIONS}
            style={{ width: 140 }}
          />
        </Col>
        <Col>
          <Tooltip title={!selectedTemplateId ? 'No template selected' : ''}>
            <Button
              size="small"
              icon={regenerate.isPending ? <SyncOutlined spin /> : <ReloadOutlined />}
              loading={regenerate.isPending}
              disabled={!selectedTemplateId || !hasContent}
              onClick={() => void regenerate.mutateAsync()}
            >
              Regenerate
            </Button>
          </Tooltip>
        </Col>
        {email.body && (
          <Col>
            <Typography.Text type="secondary" style={{ fontSize: 11, lineHeight: '24px' }}>
              {wordCount} words
            </Typography.Text>
          </Col>
        )}
      </Row>

      <div style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Subject
        </Typography.Text>
        {view === 'edit' ? (
          <Input
            value={email.subject}
            onChange={(e) =>
              onEmailUpdate(selectedRecipientIdx, { subject: e.target.value })
            }
            style={{ marginTop: 2 }}
          />
        ) : (
          <div
            style={{ padding: '4px 8px', background: '#f8f9fa', borderRadius: 4, marginTop: 2, fontWeight: 500 }}
          >
            {email.subject || <em style={{ color: '#aaa' }}>No subject</em>}
          </div>
        )}
      </div>

      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Body
        </Typography.Text>
        {view === 'edit' ? (
          <Input.TextArea
            rows={20}
            value={email.body}
            onChange={(e) =>
              onEmailUpdate(selectedRecipientIdx, { body: e.target.value })
            }
            style={{ marginTop: 2, fontFamily: 'inherit', fontSize: 13 }}
          />
        ) : (
          <div
            style={{
              padding: 12,
              background: '#f8f9fa',
              borderRadius: 4,
              marginTop: 2,
              minHeight: 300,
              fontSize: 13,
              lineHeight: 1.6,
            }}
            dangerouslySetInnerHTML={{ __html: simpleMarkdown(email.body) }}
          />
        )}
      </div>
    </div>
  );
}

function extractMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return (data.message as string[]).join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}
