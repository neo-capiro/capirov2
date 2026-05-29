import { useState } from 'react';
import { App, Button, Space, Steps, Typography } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../lib/use-api.js';
import type { Client } from '../../clients/clientTypes.js';
import type { OutreachRecipient } from '../OutreachView.js';
import { CampaignSetup } from './steps/CampaignSetup.js';
import { RecipientSelect } from './steps/RecipientSelect.js';
import { IntelligenceInsights } from './steps/IntelligenceInsights.js';
import { TemplateSelect } from './steps/TemplateSelect.js';
import { GenerateReview } from './steps/GenerateReview.js';
import { EmailEditor } from './steps/EmailEditor.js';
import { SendSchedule } from './steps/SendSchedule.js';

export type WizardTone = 'professional' | 'friendly' | 'formal' | 'concise';

export interface GeneratedEmail {
  recipientId: string;
  recipient: OutreachRecipient;
  subject: string;
  body: string;
  status: 'pending' | 'generating' | 'ready' | 'edited' | 'error';
}

interface WizardState {
  step: number;
  recordId: string | null;
  campaignName: string;
  clientId: string | null;
  direction: 'on-behalf' | 'to-clients';
  recipients: OutreachRecipient[];
  selectedInsights: string[];
  insightsNotes: string;
  selectedTemplateId: string | null;
  additionalContext: string;
  tone: WizardTone;
  generatedEmails: GeneratedEmail[];
  selectedRecipientIdx: number;
}

const INITIAL_STATE: WizardState = {
  step: 0,
  recordId: null,
  campaignName: '',
  clientId: null,
  direction: 'on-behalf',
  recipients: [],
  selectedInsights: [],
  insightsNotes: '',
  selectedTemplateId: null,
  additionalContext: '',
  tone: 'professional',
  generatedEmails: [],
  selectedRecipientIdx: 0,
};

const STEP_LABELS = [
  'Campaign Setup',
  'Recipients',
  'Intelligence',
  'Template',
  'Generate & Review',
  'Email Editor',
  'Send',
];

function recipientId(r: OutreachRecipient): string {
  return r.directoryContactId || r.email || r.name || JSON.stringify(r);
}

export function OutreachWizard({
  clients,
  selectedClientId,
  aiConfigured,
  emailConnected,
  sendFrom,
  onCancel,
  onComplete,
}: {
  clients: Client[];
  selectedClientId: string | null;
  aiConfigured: boolean;
  emailConnected: boolean;
  sendFrom: string | null;
  onCancel: () => void;
  onComplete: () => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();

  const [state, setState] = useState<WizardState>({
    ...INITIAL_STATE,
    clientId: selectedClientId,
  });

  const createRecord = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await api.post<{ id: string }>('/api/engagement/outreach', payload)).data,
  });

  const updateRecord = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      (await api.patch<{ id: string }>(`/api/engagement/outreach/${id}`, payload)).data,
  });

  const sendCampaign = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<{ recipientCount: number }>(`/api/engagement/outreach/${id}/send-campaign`))
        .data,
    onSuccess: (result) => {
      message.success(`Campaign sent to ${result.recipientCount} recipients`);
      qc.invalidateQueries({ queryKey: ['engagement-outreach'] });
      onComplete();
    },
    onError: (err: unknown) => message.error(extractMessage(err)),
  });

  const ensureRecord = async (): Promise<string> => {
    if (state.recordId) return state.recordId;
    const client = clients.find((c) => c.id === state.clientId);
    const title = state.campaignName || (client ? `${client.name} campaign` : 'Campaign');
    const record = await createRecord.mutateAsync({
      type: 'campaign',
      title,
      clientId: state.clientId ?? undefined,
      recipients: state.recipients,
      lastStep: state.step + 1,
    });
    setState((prev) => ({ ...prev, recordId: record.id }));
    return record.id;
  };

  const saveProgress = async (patch: Partial<WizardState>) => {
    const next = { ...state, ...patch };
    setState(next);
    if (!next.recordId) return;
    const client = clients.find((c) => c.id === next.clientId);
    const title = next.campaignName || (client ? `${client.name} campaign` : 'Campaign');
    await updateRecord.mutateAsync({
      id: next.recordId,
      payload: {
        title,
        clientId: next.clientId ?? undefined,
        recipients: next.recipients,
        lastStep: next.step + 1,
        metadata: {
          campaignName: next.campaignName,
          tone: next.tone,
          selectedTemplateId: next.selectedTemplateId,
          additionalContext: next.additionalContext,
          selectedInsights: next.selectedInsights,
          insightsNotes: next.insightsNotes,
          ...(next.generatedEmails.length
            ? {
                perRecipientEmails: next.generatedEmails
                  .filter((e) => e.status === 'ready' || e.status === 'edited')
                  .map((e) => ({
                    recipientId: recipientId(e.recipient),
                    subject: e.subject,
                    body: e.body,
                  })),
              }
            : {}),
        },
      },
    });
  };

  const handleCancel = () => {
    modal.confirm({
      title: 'Cancel campaign?',
      content: 'Unsaved progress on this step will be discarded.',
      okText: 'Cancel campaign',
      cancelText: 'Keep editing',
      onOk: onCancel,
    });
  };

  const goNext = async (patch?: Partial<WizardState>) => {
    const merged = patch ? { ...state, ...patch } : state;
    const nextStep = merged.step + 1;
    setState({ ...merged, step: nextStep });
  };

  const goBack = () => setState((prev) => ({ ...prev, step: Math.max(0, prev.step - 1) }));

  const saving = createRecord.isPending || updateRecord.isPending;
  const sending = sendCampaign.isPending;

  const canAdvance = (step: number): boolean => {
    if (step === 0) return Boolean(state.clientId);
    if (step === 1) return state.recipients.length > 0;
    if (step === 3) return Boolean(state.selectedTemplateId);
    if (step === 4) return state.generatedEmails.some((e) => e.status === 'ready' || e.status === 'edited');
    return true;
  };

  const nextLabel = (step: number): string => {
    if (step === 4) return 'Review Emails';
    if (step === 5) return 'Confirm Send';
    if (step === 6) return 'Send Now';
    return 'Continue';
  };

  const handleSend = async () => {
    try {
      const id = await ensureRecord();
      const client = clients.find((c) => c.id === state.clientId);
      const readyEmails = state.generatedEmails.filter(
        (e) => e.status === 'ready' || e.status === 'edited',
      );
      const firstEmail = readyEmails[0];
      await updateRecord.mutateAsync({
        id,
        payload: {
          subject: firstEmail?.subject || 'Campaign',
          body: firstEmail?.body || '',
          recipients: state.recipients,
          status: 'draft',
          title: state.campaignName || (client ? `${client.name} campaign` : 'Campaign'),
          metadata: {
            campaignName: state.campaignName,
            tone: state.tone,
            perRecipientEmails: readyEmails.map((e) => ({
              recipientId: recipientId(e.recipient),
              subject: e.subject,
              body: e.body,
            })),
          },
        },
      });
      await sendCampaign.mutateAsync(id);
    } catch (err) {
      message.error(extractMessage(err));
    }
  };

  return (
    <div className="outreach-workflow outreach-campaign-wizard">
      <div className="outreach-workflow-head">
        <Typography.Title level={3}>New Campaign</Typography.Title>
        <Space>
          <Button onClick={handleCancel}>Cancel</Button>
        </Space>
      </div>

      <div className="outreach-flow-body">
        <aside className="outreach-steps outreach-steps-ant">
          <Steps
            direction="vertical"
            size="small"
            current={state.step}
            items={STEP_LABELS.map((label, idx) => ({
              title: label,
              status:
                idx < state.step ? 'finish' : idx === state.step ? 'process' : 'wait',
              icon: idx < state.step ? <CheckOutlined /> : undefined,
            }))}
          />
        </aside>

        <main className="outreach-flow-panel">
          {state.step === 0 && (
            <CampaignSetup
              clients={clients}
              clientId={state.clientId}
              campaignName={state.campaignName}
              onChange={(patch) => setState((prev) => ({ ...prev, ...patch }))}
            />
          )}

          {state.step === 1 && (
            <RecipientSelect
              recipients={state.recipients}
              clientId={state.clientId}
              onChange={(recipients) => setState((prev) => ({ ...prev, recipients }))}
            />
          )}

          {state.step === 2 && (
            <IntelligenceInsights
              clientId={state.clientId}
              selectedInsights={state.selectedInsights}
              insightsNotes={state.insightsNotes}
              onChange={(patch) => setState((prev) => ({ ...prev, ...patch }))}
            />
          )}

          {state.step === 3 && (
            <TemplateSelect
              selectedTemplateId={state.selectedTemplateId}
              additionalContext={state.additionalContext}
              onChange={(patch) => setState((prev) => ({ ...prev, ...patch }))}
            />
          )}

          {state.step === 4 && (
            <GenerateReview
              recipients={state.recipients}
              clientId={state.clientId}
              selectedTemplateId={state.selectedTemplateId}
              selectedInsights={state.selectedInsights}
              insightsNotes={state.insightsNotes}
              additionalContext={state.additionalContext}
              tone={state.tone}
              aiConfigured={aiConfigured}
              generatedEmails={state.generatedEmails}
              selectedRecipientIdx={state.selectedRecipientIdx}
              onEmailsChange={(generatedEmails) =>
                setState((prev) => ({ ...prev, generatedEmails }))
              }
              onSelectRecipient={(idx) =>
                setState((prev) => ({ ...prev, selectedRecipientIdx: idx }))
              }
            />
          )}

          {state.step === 5 && (
            <EmailEditor
              generatedEmails={state.generatedEmails}
              selectedRecipientIdx={state.selectedRecipientIdx}
              tone={state.tone}
              clientId={state.clientId}
              selectedTemplateId={state.selectedTemplateId}
              selectedInsights={state.selectedInsights}
              additionalContext={state.additionalContext}
              onEmailUpdate={(idx, patch) => {
                setState((prev) => {
                  const emails = prev.generatedEmails.slice();
                  const email = emails[idx];
                  if (email) emails[idx] = { ...email, ...patch, status: 'edited' };
                  return { ...prev, generatedEmails: emails };
                });
              }}
              onSelectRecipient={(idx) =>
                setState((prev) => ({ ...prev, selectedRecipientIdx: idx }))
              }
              onToneChange={(tone) => setState((prev) => ({ ...prev, tone }))}
            />
          )}

          {state.step === 6 && (
            <SendSchedule
              campaignName={state.campaignName}
              clients={clients}
              clientId={state.clientId}
              recipients={state.recipients}
              generatedEmails={state.generatedEmails}
              emailConnected={emailConnected}
              sendFrom={sendFrom}
              sending={sending}
            />
          )}
        </main>
      </div>

      <div className="outreach-workflow-footer">
        <Button disabled={state.step === 0 || saving || sending} onClick={goBack}>
          Back
        </Button>
        <span>
          Step {state.step + 1} of {STEP_LABELS.length}
        </span>
        <div className="outreach-progress">
          <i style={{ width: `${((state.step + 1) / STEP_LABELS.length) * 100}%` }} />
        </div>
        {state.step < STEP_LABELS.length - 1 ? (
          <Button
            type="primary"
            loading={saving}
            disabled={!canAdvance(state.step)}
            onClick={() =>
              void (async () => {
                if (state.step >= 1 && !state.recordId) {
                  await ensureRecord();
                }
                await goNext();
                if (state.step >= 1 && state.recordId) {
                  await saveProgress({}).catch(() => {});
                }
              })()
            }
          >
            {nextLabel(state.step)}
          </Button>
        ) : (
          <Button
            type="primary"
            loading={saving || sending}
            disabled={!emailConnected || state.generatedEmails.every((e) => e.status === 'pending')}
            onClick={() => void handleSend()}
          >
            Send Campaign
          </Button>
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
