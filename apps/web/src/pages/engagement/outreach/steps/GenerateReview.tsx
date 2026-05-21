import { useState } from 'react';
import { App, Badge, Button, Input, Progress, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { useApi } from '../../../../lib/use-api.js';
import type { OutreachRecipient } from '../../OutreachView.js';
import type { GeneratedEmail, WizardTone } from '../OutreachWizard.js';

interface GenerateReviewProps {
  recipients: OutreachRecipient[];
  clientId: string | null;
  selectedTemplateId: string | null;
  selectedInsights: string[];
  insightsNotes: string;
  additionalContext: string;
  tone: WizardTone;
  aiConfigured: boolean;
  generatedEmails: GeneratedEmail[];
  selectedRecipientIdx: number;
  onEmailsChange: (emails: GeneratedEmail[]) => void;
  onSelectRecipient: (idx: number) => void;
}

function recipientId(r: OutreachRecipient): string {
  return r.directoryContactId || r.email || r.name || JSON.stringify(r);
}

function StatusIcon({ status }: { status: GeneratedEmail['status'] }) {
  if (status === 'pending') return <ClockCircleOutlined style={{ color: '#aaa' }} />;
  if (status === 'generating') return <SyncOutlined spin style={{ color: '#1890ff' }} />;
  if (status === 'ready') return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
  if (status === 'edited') return <EditOutlined style={{ color: '#1c2e4a' }} />;
  if (status === 'error') return <ExclamationCircleOutlined style={{ color: '#f5222d' }} />;
  return null;
}

function StatusTag({ status }: { status: GeneratedEmail['status'] }) {
  const map: Record<GeneratedEmail['status'], { color: string; label: string }> = {
    pending: { color: 'default', label: 'Pending' },
    generating: { color: 'processing', label: 'Generating…' },
    ready: { color: 'success', label: 'Ready' },
    edited: { color: 'blue', label: 'Edited' },
    error: { color: 'error', label: 'Error' },
  };
  const meta = map[status];
  return <Tag color={meta.color} style={{ fontSize: 11 }}>{meta.label}</Tag>;
}

export function GenerateReview({
  recipients,
  clientId,
  selectedTemplateId,
  selectedInsights,
  insightsNotes,
  additionalContext,
  tone,
  aiConfigured,
  generatedEmails,
  selectedRecipientIdx,
  onEmailsChange,
  onSelectRecipient,
}: GenerateReviewProps) {
  const api = useApi();
  const { message } = App.useApp();
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);

  const batchGenerate = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (
        await api.post<{ results: Array<{ recipientId: string; subject: string; body: string }> }>(
          '/api/engagement/outreach/generate-batch',
          payload,
        )
      ).data,
  });

  const allInsights = [
    ...selectedInsights,
    ...(insightsNotes.trim() ? [insightsNotes.trim()] : []),
  ];

  const buildPayload = (recipientSubset: OutreachRecipient[]) => ({
    clientId: clientId ?? undefined,
    templateId: selectedTemplateId!,
    recipients: recipientSubset,
    insights: allInsights.length ? allInsights : undefined,
    additionalContext: additionalContext || undefined,
    tone,
  });

  const initEmails = (): GeneratedEmail[] =>
    recipients.map((r) => {
      const existing = generatedEmails.find((e) => recipientId(e.recipient) === recipientId(r));
      return (
        existing ?? {
          recipientId: recipientId(r),
          recipient: r,
          subject: '',
          body: '',
          status: 'pending' as const,
        }
      );
    });

  const generateAll = async () => {
    if (!selectedTemplateId) {
      message.warning('Select a template first');
      return;
    }
    setGeneratingAll(true);
    const base = initEmails();
    const generating = base.map((e) => ({ ...e, status: 'generating' as const }));
    onEmailsChange(generating);

    try {
      const result = await batchGenerate.mutateAsync(buildPayload(recipients));
      const resultMap = new Map(result.results.map((r) => [r.recipientId, r]));
      const updated = generating.map((e) => {
        const match = resultMap.get(recipientId(e.recipient)) ?? resultMap.get(e.recipient.email ?? '') ?? resultMap.get(e.recipient.directoryContactId ?? '');
        if (!match || (!match.subject && !match.body)) {
          return { ...e, status: 'error' as const };
        }
        return { ...e, subject: match.subject, body: match.body, status: 'ready' as const };
      });
      onEmailsChange(updated);
      const ready = updated.filter((e) => e.status === 'ready').length;
      message.success(`Generated ${ready} of ${recipients.length} emails`);
    } catch (err: unknown) {
      message.error(extractMessage(err));
      onEmailsChange(initEmails().map((e) => ({ ...e, status: 'pending' as const })));
    } finally {
      setGeneratingAll(false);
    }
  };

  const regenerateOne = async (idx: number) => {
    const email = emails[idx];
    if (!email || !selectedTemplateId) return;
    setGeneratingIdx(idx);
    const updated = emails.slice();
    updated[idx] = { ...email, status: 'generating' };
    onEmailsChange(updated);

    try {
      const result = await batchGenerate.mutateAsync(buildPayload([email.recipient]));
      const match = result.results[0];
      const final = emails.slice();
      if (match && (match.subject || match.body)) {
        final[idx] = { ...email, subject: match.subject, body: match.body, status: 'ready' };
      } else {
        final[idx] = { ...email, status: 'error' };
      }
      onEmailsChange(final);
    } catch (err: unknown) {
      message.error(extractMessage(err));
      const reset = emails.slice();
      reset[idx] = { ...email, status: 'error' };
      onEmailsChange(reset);
    } finally {
      setGeneratingIdx(null);
    }
  };

  const updateEmail = (idx: number, field: 'subject' | 'body', value: string) => {
    const updated = emails.slice();
    const email = updated[idx];
    if (email) updated[idx] = { ...email, [field]: value, status: 'edited' };
    onEmailsChange(updated);
  };

  const emails = initEmails();
  const readyCount = emails.filter((e) => e.status === 'ready' || e.status === 'edited').length;
  const selectedEmail = emails[selectedRecipientIdx] ?? emails[0];
  const selectedIdx = selectedEmail ? emails.indexOf(selectedEmail) : 0;

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 500 }}>
      <div
        style={{
          width: 220,
          borderRight: '1px solid #e8e8e8',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #e8e8e8' }}>
          <Button
            type="primary"
            icon={generatingAll ? <SyncOutlined spin /> : <PlayCircleOutlined />}
            size="small"
            block
            loading={generatingAll}
            disabled={!selectedTemplateId || !aiConfigured}
            onClick={() => void generateAll()}
          >
            Generate all
          </Button>
          {readyCount > 0 && (
            <div style={{ marginTop: 6 }}>
              <Progress
                percent={Math.round((readyCount / recipients.length) * 100)}
                size="small"
                format={() => `${readyCount}/${recipients.length}`}
              />
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {emails.map((email, idx) => (
            <button
              key={email.recipientId}
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                width: '100%',
                textAlign: 'left',
                background: idx === selectedIdx ? '#1c2e4a0a' : 'transparent',
                border: 'none',
                borderBottom: '1px solid #f0f0f0',
                cursor: 'pointer',
              }}
              onClick={() => onSelectRecipient(idx)}
            >
              <StatusIcon status={email.status} />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: idx === selectedIdx ? 600 : 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {email.recipient.name || email.recipient.email || 'Recipient'}
                </div>
                {email.recipient.state && (
                  <div style={{ fontSize: 11, color: '#888' }}>{email.recipient.state}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto' }}>
        {!selectedEmail ? (
          <Typography.Text type="secondary">No recipients selected.</Typography.Text>
        ) : (
          <div>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}
            >
              <div>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  {selectedEmail.recipient.name || selectedEmail.recipient.email || 'Recipient'}
                </Typography.Text>
                {selectedEmail.recipient.office && (
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {selectedEmail.recipient.office}
                  </Typography.Text>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <StatusTag status={selectedEmail.status} />
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={generatingIdx === selectedIdx}
                  disabled={!selectedTemplateId || !aiConfigured || generatingAll}
                  onClick={() => void regenerateOne(selectedIdx)}
                >
                  Regenerate
                </Button>
              </div>
            </div>

            {selectedEmail.status === 'pending' ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>
                <PlayCircleOutlined style={{ fontSize: 32 }} />
                <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                  Click <strong>Generate all</strong> to create this email, or{' '}
                  <strong>Regenerate</strong> to generate just this one.
                </Typography.Paragraph>
              </div>
            ) : selectedEmail.status === 'generating' ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <SyncOutlined spin style={{ fontSize: 32, color: '#1890ff' }} />
                <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                  Clio is writing this email…
                </Typography.Paragraph>
              </div>
            ) : selectedEmail.status === 'error' ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#f5222d' }}>
                <ExclamationCircleOutlined style={{ fontSize: 32 }} />
                <Typography.Paragraph style={{ marginTop: 8 }}>
                  Generation failed. Click <strong>Regenerate</strong> to retry.
                </Typography.Paragraph>
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Subject
                  </Typography.Text>
                  <Input
                    value={selectedEmail.subject}
                    onChange={(e) => updateEmail(selectedIdx, 'subject', e.target.value)}
                    style={{ marginTop: 2 }}
                  />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Body
                  </Typography.Text>
                  <Input.TextArea
                    rows={16}
                    value={selectedEmail.body}
                    onChange={(e) => updateEmail(selectedIdx, 'body', e.target.value)}
                    style={{ marginTop: 2, fontFamily: 'inherit', fontSize: 13 }}
                  />
                </div>
              </div>
            )}

            {(selectedEmail.recipient.committee || selectedEmail.recipient.state) && (
              <div style={{ marginTop: 12, display: 'flex', gap: 4 }}>
                {selectedEmail.recipient.committee && (
                  <Badge
                    count={selectedEmail.recipient.committee}
                    style={{ backgroundColor: '#6b7280', fontSize: 11 }}
                    overflowCount={Infinity}
                  />
                )}
              </div>
            )}
          </div>
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
