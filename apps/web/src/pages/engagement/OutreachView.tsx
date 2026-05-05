import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CheckOutlined,
  FileTextOutlined,
  MailOutlined,
  PlusOutlined,
  RobotOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Empty, Input, Select, Space, Tag, Typography } from 'antd';
import { useApi } from '../../lib/use-api.js';
import type { Client } from '../clients/clientTypes.js';
import type { DirectoryApiResponse, DirectoryEntry } from '../directory/directoryData.js';

type OutreachType = 'all' | 'campaign' | 'follow_up' | 'prep';
type WorkflowType = 'campaign' | 'follow_up' | 'prep';
type OutreachStatus = 'draft' | 'sent' | 'opened_in_email' | 'failed';

interface OutreachRecipient {
  name?: string;
  email?: string;
  office?: string;
  title?: string;
  state?: string;
  district?: string;
  party?: string;
  directoryContactId?: string;
  directoryContactName?: string;
  committee?: string;
  relevanceReason?: string;
  personalNote?: string;
}

interface OutreachRecord {
  id: string;
  clientId: string | null;
  meetingId: string | null;
  type: WorkflowType;
  status: OutreachStatus;
  title: string;
  subject: string | null;
  body: string | null;
  recipients: OutreachRecipient[];
  recipientCount: number;
  stats: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  lastStep: number;
  sentAt: string | null;
  openedInEmailAt: string | null;
  createdAt: string;
  updatedAt: string;
  client: Pick<Client, 'id' | 'name' | 'website' | 'intakeData'> | null;
  meeting: OutreachMeeting | null;
}

interface OutreachMeeting {
  id: string;
  clientId: string | null;
  subject: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  organizerEmail: string | null;
  organizerName: string | null;
  metadata: Record<string, unknown> | null;
  client: Pick<Client, 'id' | 'name' | 'website' | 'intakeData'> | null;
  attendees: Array<{ id: string; email: string | null; name: string | null; role: string | null }>;
  preps: Array<{
    id: string;
    status: string;
    summary: string | null;
    agenda: string[];
    talkingPoints: string[];
    risks: string[];
    followUps: string[];
  }>;
  debriefs: Array<{ id: string; createdAt: string }>;
}

interface IntegrationConnection {
  id: string;
  provider: string;
  status: string;
}

interface OutreachWorkflowState {
  record: OutreachRecord | null;
  step: number;
  campaignName: string;
  objective: string;
  clientId: string | null;
  meetingId: string | null;
  recipients: OutreachRecipient[];
  subject: string;
  body: string;
  selectedPreviewIndex: number;
  recipientInput: string;
}

const TYPE_FILTERS: Array<{ value: OutreachType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'campaign', label: 'Campaigns' },
  { value: 'follow_up', label: 'Follow-ups' },
  { value: 'prep', label: 'Prep' },
];

const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  campaign: 'Campaign',
  follow_up: 'Meeting follow-up',
  prep: 'Prep distribution',
};

const EMPTY_WORKFLOW: OutreachWorkflowState = {
  record: null,
  step: 1,
  campaignName: '',
  objective: '',
  clientId: null,
  meetingId: null,
  recipients: [],
  subject: '',
  body: '',
  selectedPreviewIndex: 0,
  recipientInput: '',
};

export function OutreachView({
  clients,
  selectedClientId,
  aiConfigured,
}: {
  clients: Client[];
  selectedClientId: string | null;
  aiConfigured: boolean;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const today = todayInputValue();
  const [from, setFrom] = useState(inputValueFromDate(addLocalDays(new Date(), -30)));
  const [to, setTo] = useState(today);
  const [typeFilter, setTypeFilter] = useState<OutreachType>('all');
  const [mode, setMode] = useState<'landing' | 'selector' | WorkflowType | 'readonly'>('landing');
  const [workflow, setWorkflow] = useState<OutreachWorkflowState>(() => ({
    ...EMPTY_WORKFLOW,
    clientId: selectedClientId,
  }));
  const [readonlyRecord, setReadonlyRecord] = useState<OutreachRecord | null>(null);
  const [directoryQuery, setDirectoryQuery] = useState('');

  useEffect(() => {
    const locked = mode !== 'landing';
    window.dispatchEvent(new CustomEvent('capiro:workflow-lock', { detail: { locked } }));
    return () => {
      window.dispatchEvent(new CustomEvent('capiro:workflow-lock', { detail: { locked: false } }));
    };
  }, [mode]);

  const activeClients = useMemo(
    () =>
      clients
        .filter((client) => client.status !== 'archived')
        .sort((left, right) => left.name.localeCompare(right.name)),
    [clients],
  );
  const selectedClient = activeClients.find((client) => client.id === selectedClientId) ?? null;

  const outreach = useQuery<OutreachRecord[]>({
    queryKey: ['engagement-outreach', selectedClientId, from, to, typeFilter],
    queryFn: async () =>
      (
        await api.get<OutreachRecord[]>('/api/engagement/outreach', {
          params: {
            clientId: selectedClientId ?? undefined,
            from: localDateStartIso(from),
            to: localDateEndIso(to),
            type: typeFilter === 'all' ? undefined : typeFilter,
          },
        })
      ).data,
  });

  const integrations = useQuery<IntegrationConnection[]>({
    queryKey: ['engagement-integrations'],
    queryFn: async () =>
      (await api.get<IntegrationConnection[]>('/api/engagement/integrations')).data,
  });
  const emailConnected = (integrations.data ?? []).some(
    (connection) =>
      connection.status === 'connected' &&
      (connection.provider === 'microsoft_365' || connection.provider === 'google_workspace'),
  );

  const pastMeetings = useQuery<OutreachMeeting[]>({
    queryKey: ['engagement-outreach-past-meetings', selectedClientId],
    queryFn: async () =>
      (
        await api.get<OutreachMeeting[]>('/api/engagement/meetings', {
          params: {
            clientId: selectedClientId ?? undefined,
            from: addLocalDays(new Date(), -365).toISOString(),
            to: new Date().toISOString(),
          },
        })
      ).data,
    enabled: mode === 'follow_up',
  });

  const upcomingMeetings = useQuery<OutreachMeeting[]>({
    queryKey: ['engagement-outreach-upcoming-meetings', selectedClientId],
    queryFn: async () =>
      (
        await api.get<OutreachMeeting[]>('/api/engagement/meetings', {
          params: {
            clientId: selectedClientId ?? undefined,
            from: new Date().toISOString(),
            to: addLocalDays(new Date(), 90).toISOString(),
          },
        })
      ).data,
    enabled: mode === 'prep',
  });

  const directory = useQuery<DirectoryApiResponse>({
    queryKey: ['engagement-outreach-directory', directoryQuery],
    queryFn: async () =>
      (
        await api.get<DirectoryApiResponse>('/api/directory/contacts', {
          params: { q: directoryQuery, pageSize: 20 },
        })
      ).data,
    enabled: mode === 'campaign' && directoryQuery.trim().length >= 2,
  });

  const createRecord = useMutation({
    mutationFn: async (payload: Partial<OutreachRecord> & { type: WorkflowType; title: string }) =>
      (await api.post<OutreachRecord>('/api/engagement/outreach', payload)).data,
    onSuccess: (record) => {
      setWorkflow((current) => hydrateWorkflowFromRecord(record, current));
      qc.invalidateQueries({ queryKey: ['engagement-outreach'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const updateRecord = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      (await api.patch<OutreachRecord>(`/api/engagement/outreach/${id}`, payload)).data,
    onSuccess: (record) => {
      setWorkflow((current) => hydrateWorkflowFromRecord(record, current));
      qc.invalidateQueries({ queryKey: ['engagement-outreach'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const generateDraft = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      (await api.post<OutreachRecord>(`/api/engagement/outreach/${id}/generate-draft`, payload))
        .data,
    onSuccess: (record) => {
      message.success('Clio draft ready');
      setWorkflow((current) => hydrateWorkflowFromRecord(record, current));
      qc.invalidateQueries({ queryKey: ['engagement-outreach'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const openEmail = useMutation({
    mutationFn: async (id: string) =>
      (
        await api.post<{ record: OutreachRecord; mailtoUrl: string }>(
          `/api/engagement/outreach/${id}/open-email`,
        )
      ).data,
    onSuccess: (result) => {
      window.location.href = result.mailtoUrl;
      message.success('Opened in connected email');
      qc.invalidateQueries({ queryKey: ['engagement-outreach'] });
      setMode('landing');
      setWorkflow({ ...EMPTY_WORKFLOW, clientId: selectedClientId });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const sendCampaign = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<OutreachRecord>(`/api/engagement/outreach/${id}/send-campaign`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engagement-outreach'] });
      setMode('landing');
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const saveCurrent = async (patch: Partial<OutreachWorkflowState>, step?: number) => {
    const next = { ...workflow, ...patch, step: step ?? workflow.step };
    setWorkflow(next);
    const payload = workflowPayload(next);
    if (next.record) {
      await updateRecord.mutateAsync({ id: next.record.id, payload });
      return;
    }
    const type = mode as WorkflowType;
    if (!['campaign', 'follow_up', 'prep'].includes(type)) return;
    await createRecord.mutateAsync({
      type,
      title: payload.title as string,
      clientId: (payload.clientId as string | null) ?? undefined,
      meetingId: (payload.meetingId as string | null) ?? undefined,
      subject: (payload.subject as string | null) ?? undefined,
      body: (payload.body as string | null) ?? undefined,
      recipients: payload.recipients as OutreachRecipient[],
      metadata: payload.metadata as Record<string, unknown>,
      lastStep: payload.lastStep as number,
    });
  };

  const startWorkflow = (type: WorkflowType) => {
    setMode(type);
    setWorkflow({
      ...EMPTY_WORKFLOW,
      clientId: selectedClientId,
      step: 1,
    });
    if (type === 'campaign') {
      const client = selectedClient ?? activeClients[0] ?? null;
      setWorkflow((current) => ({
        ...current,
        clientId: client?.id ?? null,
        campaignName: client ? `${client.name} outreach` : '',
      }));
      setDirectoryQuery(client ? objectiveSearchSeed(client) : '');
    }
  };

  const openDraft = (record: OutreachRecord) => {
    setWorkflow(hydrateWorkflowFromRecord(record, EMPTY_WORKFLOW));
    setMode(record.type);
  };

  const openReadonly = (record: OutreachRecord) => {
    setReadonlyRecord(record);
    setMode('readonly');
  };

  const cancelWorkflow = () => {
    modal.confirm({
      title: 'Cancel outreach workflow?',
      content: 'Cancelling returns to Outreach. Unsaved field edits on this step will be discarded.',
      okText: 'Cancel workflow',
      cancelText: 'Keep editing',
      onOk: () => {
        setMode('landing');
        setWorkflow({ ...EMPTY_WORKFLOW, clientId: selectedClientId });
        setReadonlyRecord(null);
      },
    });
  };

  if (mode === 'selector') {
    return <OutreachTypeSelector onCancel={() => setMode('landing')} onSelect={startWorkflow} />;
  }

  if (mode === 'readonly' && readonlyRecord) {
    return <OutreachReadonly record={readonlyRecord} onClose={() => setMode('landing')} />;
  }

  if (mode === 'campaign') {
    return (
      <CampaignWorkflow
        clients={activeClients}
        workflow={workflow}
        directoryRows={directory.data?.contacts ?? []}
        directoryLoading={directory.isLoading}
        directoryQuery={directoryQuery}
        aiConfigured={aiConfigured}
        saving={createRecord.isPending || updateRecord.isPending}
        generating={generateDraft.isPending}
        sending={sendCampaign.isPending}
        onDirectoryQuery={setDirectoryQuery}
        onWorkflowChange={setWorkflow}
        onCancel={cancelWorkflow}
        onSaveStep={saveCurrent}
        onGenerate={() => {
          if (!workflow.record) return;
          void generateDraft.mutateAsync({
            id: workflow.record.id,
            payload: {
              objective: workflow.objective,
              recipients: workflow.recipients,
              metadata: { campaignName: workflow.campaignName },
            },
          });
        }}
        onSend={() => {
          if (workflow.record) sendCampaign.mutate(workflow.record.id);
        }}
      />
    );
  }

  if (mode === 'follow_up') {
    return (
      <FollowUpWorkflow
        workflow={workflow}
        meetings={(pastMeetings.data ?? []).slice().reverse()}
        loading={pastMeetings.isLoading}
        emailConnected={emailConnected}
        aiConfigured={aiConfigured}
        saving={createRecord.isPending || updateRecord.isPending}
        generating={generateDraft.isPending}
        opening={openEmail.isPending}
        onWorkflowChange={setWorkflow}
        onCancel={cancelWorkflow}
        onSaveStep={saveCurrent}
        onGenerate={() => {
          if (!workflow.record) return;
          void generateDraft.mutateAsync({
            id: workflow.record.id,
            payload: { recipients: workflow.recipients },
          });
        }}
        onOpenEmail={() => {
          if (workflow.record) openEmail.mutate(workflow.record.id);
        }}
      />
    );
  }

  if (mode === 'prep') {
    return (
      <PrepDistributionWorkflow
        workflow={workflow}
        meetings={upcomingMeetings.data ?? []}
        loading={upcomingMeetings.isLoading}
        emailConnected={emailConnected}
        aiConfigured={aiConfigured}
        saving={createRecord.isPending || updateRecord.isPending}
        generating={generateDraft.isPending}
        opening={openEmail.isPending}
        onWorkflowChange={setWorkflow}
        onCancel={cancelWorkflow}
        onSaveStep={saveCurrent}
        onGenerate={() => {
          if (!workflow.record) return;
          void generateDraft.mutateAsync({
            id: workflow.record.id,
            payload: { recipients: workflow.recipients },
          });
        }}
        onOpenEmail={() => {
          if (workflow.record) openEmail.mutate(workflow.record.id);
        }}
      />
    );
  }

  const rows = outreach.data ?? [];
  const drafts = rows.filter((record) => record.status === 'draft');
  const sent = rows.filter((record) => record.status !== 'draft');

  return (
    <div className="outreach-page">
      <div className="outreach-filter-bar">
        <span>Date range</span>
        <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <span>-</span>
        <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <div className="outreach-type-pills">
          {TYPE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={typeFilter === filter.value ? 'active' : ''}
              onClick={() => setTypeFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setMode('selector')}>
          New Outreach
        </Button>
      </div>

      {outreach.isLoading ? (
        <div className="outreach-card-list">
          <Empty description="Loading outreach..." />
        </div>
      ) : rows.length ? (
        <>
          {drafts.length ? (
            <section className="outreach-section">
              <Typography.Title level={5}>Drafts</Typography.Title>
              <div className="outreach-card-list">
                {drafts.map((record) => (
                  <OutreachRecordCard key={record.id} record={record} onClick={openDraft} />
                ))}
              </div>
            </section>
          ) : null}

          <div className="outreach-sent-divider">
            <span />
            <strong>Sent</strong>
            <span />
          </div>

          {sent.length ? (
            <div className="outreach-card-list">
              {sent.map((record) => (
                <OutreachRecordCard key={record.id} record={record} onClick={openReadonly} />
              ))}
            </div>
          ) : (
            <Empty description="No sent or opened outreach in this date range." />
          )}
          <Button block>Load more</Button>
        </>
      ) : (
        <div className="outreach-empty">
          <Empty
            description={
              <span>
                <strong>No outreach yet</strong>
                <br />
                Start by creating a campaign, follow-up, or prep distribution.
              </span>
            }
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setMode('selector')}>
              New Outreach
            </Button>
          </Empty>
        </div>
      )}
    </div>
  );
}

function OutreachTypeSelector({
  onCancel,
  onSelect,
}: {
  onCancel: () => void;
  onSelect: (type: WorkflowType) => void;
}) {
  return (
    <div className="outreach-workflow">
      <WorkflowHeader title="New Outreach" onCancel={onCancel} />
      <div className="outreach-type-selector">
        <Typography.Title level={4}>What type of outreach do you want to send?</Typography.Title>
        <Typography.Paragraph type="secondary">
          Clio drafts the content from Capiro context. You review and edit before anything is sent.
        </Typography.Paragraph>
        <div className="outreach-type-grid">
          <OutreachTypeCard
            icon={<MailOutlined />}
            title="Campaign"
            description="Personalized mass outreach to multiple congressional offices or contacts on behalf of a client."
            detail="Sends from Capiro using your connected Microsoft 365 inbox. Replies go to your inbox."
            onClick={() => onSelect('campaign')}
          />
          <OutreachTypeCard
            icon={<FileTextOutlined />}
            title="Meeting follow-up"
            description="Post-meeting email to participants, client, or congressional office. Clio drafts from your debrief."
            detail="Opens in your connected email. You send from your own inbox."
            onClick={() => onSelect('follow_up')}
          />
          <OutreachTypeCard
            icon={<RobotOutlined />}
            title="Prep distribution"
            description="Share meeting prep notes with a colleague or client ahead of an upcoming meeting."
            detail="Opens in your connected email. You send from your own inbox."
            onClick={() => onSelect('prep')}
          />
        </div>
      </div>
    </div>
  );
}

function OutreachTypeCard({
  icon,
  title,
  description,
  detail,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="outreach-type-card" onClick={onClick}>
      <span className="outreach-type-icon">{icon}</span>
      <strong>{title}</strong>
      <span>{description}</span>
      <em>{detail}</em>
    </button>
  );
}

function CampaignWorkflow({
  clients,
  workflow,
  directoryRows,
  directoryLoading,
  directoryQuery,
  aiConfigured,
  saving,
  generating,
  sending,
  onDirectoryQuery,
  onWorkflowChange,
  onCancel,
  onSaveStep,
  onGenerate,
  onSend,
}: {
  clients: Client[];
  workflow: OutreachWorkflowState;
  directoryRows: DirectoryEntry[];
  directoryLoading: boolean;
  directoryQuery: string;
  aiConfigured: boolean;
  saving: boolean;
  generating: boolean;
  sending: boolean;
  onDirectoryQuery: (value: string) => void;
  onWorkflowChange: (value: OutreachWorkflowState) => void;
  onCancel: () => void;
  onSaveStep: (patch: Partial<OutreachWorkflowState>, step?: number) => Promise<void>;
  onGenerate: () => void;
  onSend: () => void;
}) {
  const selectedClient = clients.find((client) => client.id === workflow.clientId) ?? null;
  const selectedRecipient = workflow.recipients[workflow.selectedPreviewIndex] ?? null;

  return (
    <div className="outreach-workflow">
      <WorkflowHeader title="New Campaign" onCancel={onCancel} />
      <div className="outreach-flow-body">
        <WorkflowSteps
          steps={[
            ['Setup', 'Client and objective'],
            ['Recipients', 'Directory targets'],
            ['Draft', 'Edit body, place {personal_note}'],
            ['Personal notes', 'Optional per recipient'],
            ['Preview & send', 'Final review'],
          ]}
          current={workflow.step}
        />
        <main className="outreach-flow-panel">
          {workflow.step === 1 ? (
            <div className="outreach-flow-stack">
              <Typography.Title level={4}>Campaign setup</Typography.Title>
              {clients.length ? (
                <>
                  <label>
                    Client
                    <Select
                      value={workflow.clientId ?? undefined}
                      options={clients.map((client) => ({ value: client.id, label: client.name }))}
                      onChange={(clientId) =>
                        onWorkflowChange({
                          ...workflow,
                          clientId,
                          campaignName:
                            workflow.campaignName ||
                            `${clients.find((client) => client.id === clientId)?.name} outreach`,
                        })
                      }
                    />
                  </label>
                  <label>
                    Campaign name
                    <Input
                      value={workflow.campaignName}
                      onChange={(event) =>
                        onWorkflowChange({ ...workflow, campaignName: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Objective
                    <Input.TextArea
                      rows={5}
                      value={workflow.objective}
                      placeholder="What do you want recipients to do or know?"
                      onChange={(event) =>
                        onWorkflowChange({ ...workflow, objective: event.target.value })
                      }
                    />
                  </label>
                </>
              ) : (
                <Empty
                  description="Add a client before creating a campaign."
                >
                  <Button href="/clients">Go to Clients</Button>
                </Empty>
              )}
            </div>
          ) : null}

          {workflow.step === 2 ? (
            <div className="outreach-flow-stack">
              <Typography.Title level={4}>Who are you reaching out to?</Typography.Title>
              <div className="outreach-context-note">
                <RobotOutlined />
                <span>
                  Directory suggestions below are searched from the live Directory using this
                  campaign objective and any query you type.
                </span>
              </div>
              <Input
                prefix={<SearchOutlined />}
                value={directoryQuery}
                placeholder="Search Directory"
                onChange={(event) => onDirectoryQuery(event.target.value)}
              />
              <div className="outreach-recipient-results">
                {directoryLoading ? (
                  <Typography.Text type="secondary">Searching Directory...</Typography.Text>
                ) : directoryRows.length ? (
                  directoryRows.map((entry) => (
                    <DirectoryRecipientRow
                      key={entry.id}
                      entry={entry}
                      selected={workflow.recipients.some(
                        (recipient) => recipient.directoryContactId === entry.id,
                      )}
                      onAdd={(recipient) =>
                        onWorkflowChange({
                          ...workflow,
                          recipients: addUniqueRecipient(workflow.recipients, recipient),
                        })
                      }
                    />
                  ))
                ) : (
                  <Empty description="Search the Directory to add members or staffers." />
                )}
              </div>
              <RecipientTags
                recipients={workflow.recipients}
                onRemove={(recipient) =>
                  onWorkflowChange({
                    ...workflow,
                    recipients: removeRecipient(workflow.recipients, recipient),
                  })
                }
              />
            </div>
          ) : null}

          {workflow.step === 3 ? (
            <DraftStep
              heading="Review and edit Clio's draft"
              contextNote={`Drafting from ${selectedClient?.name ?? 'selected client'} context, objective, and ${workflow.recipients.length} selected recipients.`}
              aiConfigured={aiConfigured}
              generating={generating}
              subject={workflow.subject}
              body={workflow.body}
              onGenerate={onGenerate}
              onSubject={(subject) => onWorkflowChange({ ...workflow, subject })}
              onBody={(body) => onWorkflowChange({ ...workflow, body })}
            />
          ) : null}

          {workflow.step === 4 ? (
            <div className="outreach-flow-stack">
              <Typography.Title level={4}>Add a personal note per recipient</Typography.Title>
              <Typography.Paragraph type="secondary">
                Optional. Clio will weave your note into the position you set in the draft.
              </Typography.Paragraph>
              <div className="outreach-notes-table">
                <div className="outreach-notes-head">
                  <span>Recipient</span>
                  <span>Auto-personalized preview</span>
                  <span>Personal note (optional)</span>
                </div>
                {workflow.recipients.map((recipient, index) => (
                  <div className="outreach-notes-row" key={recipientKey(recipient)}>
                    <div>
                      <strong>{recipient.name}</strong>
                      <span>{recipient.office || recipient.email}</span>
                    </div>
                    <span>{personalizedPreview(recipient)}</span>
                    <Input
                      value={recipient.personalNote}
                      placeholder="Add a personal note..."
                      onChange={(event) => {
                        const recipients = workflow.recipients.slice();
                        recipients[index] = { ...recipient, personalNote: event.target.value };
                        onWorkflowChange({ ...workflow, recipients });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {workflow.step === 5 ? (
            <div className="outreach-flow-stack">
              <Typography.Title level={4}>Review each email before sending</Typography.Title>
              <div className="outreach-preview-layout">
                <div className="outreach-preview-list">
                  {workflow.recipients.map((recipient, index) => (
                    <button
                      key={recipientKey(recipient)}
                      type="button"
                      className={workflow.selectedPreviewIndex === index ? 'active' : ''}
                      onClick={() =>
                        onWorkflowChange({ ...workflow, selectedPreviewIndex: index })
                      }
                    >
                      {recipient.name || recipient.email}
                    </button>
                  ))}
                </div>
                <EmailPreview
                  to={selectedRecipient?.email || selectedRecipient?.name || 'Recipient'}
                  subject={workflow.subject}
                  body={assembleCampaignBody(workflow.body, selectedRecipient)}
                />
              </div>
              <div className="outreach-send-warning">
                Campaigns send from Capiro using your connected Microsoft 365 inbox. Every
                recipient must have an email address.
              </div>
            </div>
          ) : null}
        </main>
      </div>
      <WorkflowFooter
        step={workflow.step}
        total={5}
        saving={saving}
        nextLabel={workflow.step === 5 ? 'Send campaign' : 'Continue'}
        nextLoading={sending}
        nextDisabled={
          (workflow.step === 1 &&
            (!workflow.clientId || !workflow.campaignName.trim() || !workflow.objective.trim())) ||
          (workflow.step === 2 && workflow.recipients.length < 1) ||
          (workflow.step === 3 && (!workflow.subject.trim() || !workflow.body.trim()))
        }
        onBack={() => onWorkflowChange({ ...workflow, step: Math.max(1, workflow.step - 1) })}
        onNext={() => {
          if (workflow.step === 5) {
            onSend();
            return;
          }
          const nextStep = workflow.step + 1;
          void onSaveStep(workflow, nextStep);
        }}
      />
    </div>
  );
}

function FollowUpWorkflow(props: SharedWorkflowProps & { meetings: OutreachMeeting[]; loading: boolean }) {
  return (
    <SmallGroupWorkflow
      {...props}
      type="follow_up"
      title="Meeting Follow-up"
      total={4}
      meetings={props.meetings}
      loading={props.loading}
      selectHeading="Which meeting is this follow-up for?"
      recipientsHeading={(meeting) => `${meeting.subject} - ${formatOptionalDate(meeting.startsAt)}`}
      draftHeading="Review Clio's follow-up draft"
      readyHeading="Your draft is ready"
      noMeetingsText="No past meetings found. Meetings appear here after they have taken place."
      meetingFilter={(meeting) => new Date(meeting.endsAt).getTime() <= Date.now()}
      meetingDisabled={() => false}
      disabledReason={() => null}
      prepopulateRecipients={meetingRecipients}
    />
  );
}

function PrepDistributionWorkflow(
  props: SharedWorkflowProps & { meetings: OutreachMeeting[]; loading: boolean },
) {
  return (
    <SmallGroupWorkflow
      {...props}
      type="prep"
      title="Prep Distribution"
      total={4}
      meetings={props.meetings}
      loading={props.loading}
      selectHeading="Which meeting are you sharing prep for?"
      recipientsHeading={() => 'Who are you sharing prep with?'}
      draftHeading="Review Clio's prep summary"
      readyHeading="Your draft is ready"
      noMeetingsText="No upcoming meetings have prep ready yet. Complete prep notes in the Meetings tab first."
      meetingFilter={(meeting) => new Date(meeting.startsAt).getTime() >= Date.now()}
      meetingDisabled={(meeting) => meeting.preps[0]?.status !== 'approved'}
      disabledReason={() => 'Prep not ready'}
      prepopulateRecipients={() => []}
    />
  );
}

interface SharedWorkflowProps {
  workflow: OutreachWorkflowState;
  emailConnected: boolean;
  aiConfigured: boolean;
  saving: boolean;
  generating: boolean;
  opening: boolean;
  onWorkflowChange: (value: OutreachWorkflowState) => void;
  onCancel: () => void;
  onSaveStep: (patch: Partial<OutreachWorkflowState>, step?: number) => Promise<void>;
  onGenerate: () => void;
  onOpenEmail: () => void;
}

function SmallGroupWorkflow({
  type,
  title,
  total,
  meetings,
  loading,
  workflow,
  emailConnected,
  aiConfigured,
  saving,
  generating,
  opening,
  selectHeading,
  recipientsHeading,
  draftHeading,
  readyHeading,
  noMeetingsText,
  meetingFilter,
  meetingDisabled,
  disabledReason,
  prepopulateRecipients,
  onWorkflowChange,
  onCancel,
  onSaveStep,
  onGenerate,
  onOpenEmail,
}: SharedWorkflowProps & {
  type: WorkflowType;
  title: string;
  total: number;
  meetings: OutreachMeeting[];
  loading: boolean;
  selectHeading: string;
  recipientsHeading: (meeting: OutreachMeeting) => string;
  draftHeading: string;
  readyHeading: string;
  noMeetingsText: string;
  meetingFilter: (meeting: OutreachMeeting) => boolean;
  meetingDisabled: (meeting: OutreachMeeting) => boolean;
  disabledReason: (meeting: OutreachMeeting) => string | null;
  prepopulateRecipients: (meeting: OutreachMeeting) => OutreachRecipient[];
}) {
  const visibleMeetings = meetings.filter(meetingFilter);
  const selectedMeeting = visibleMeetings.find((meeting) => meeting.id === workflow.meetingId);

  return (
    <div className="outreach-workflow">
      <WorkflowHeader title={title} onCancel={onCancel} />
      <div className="outreach-flow-body">
        <WorkflowSteps
          current={workflow.step}
          steps={
            type === 'follow_up'
              ? [
                  ['Select meeting', 'Past meetings'],
                  ['Recipients', 'Auto-populated from meeting'],
                  ['Review draft', "Edit Clio's draft"],
                  ['Open in email', 'Pre-filled, send from your inbox'],
                ]
              : [
                  ['Select meeting', 'Upcoming meetings only'],
                  ['Recipients', 'Colleagues or client'],
                  ['Review draft', "Edit Clio's prep summary"],
                  ['Open in email', 'Pre-filled, send from your inbox'],
                ]
          }
        />
        <main className="outreach-flow-panel">
          {workflow.step === 1 ? (
            <div className="outreach-flow-stack">
              <Typography.Title level={4}>{selectHeading}</Typography.Title>
              <div className="outreach-meeting-picker">
                {loading ? (
                  <Typography.Text type="secondary">Loading meetings...</Typography.Text>
                ) : visibleMeetings.length ? (
                  visibleMeetings.map((meeting) => {
                    const disabled = meetingDisabled(meeting);
                    return (
                      <button
                        key={meeting.id}
                        type="button"
                        disabled={disabled}
                        className={workflow.meetingId === meeting.id ? 'selected' : ''}
                        onClick={() => {
                          const recipients = prepopulateRecipients(meeting);
                          void onSaveStep(
                            {
                              meetingId: meeting.id,
                              clientId: meeting.clientId,
                              recipients,
                              campaignName: meeting.subject,
                              subject: workflow.subject,
                              body: workflow.body,
                            },
                            2,
                          );
                        }}
                      >
                        <span />
                        <strong>{meeting.subject}</strong>
                        <small>
                          {[formatDateTime(meeting.startsAt), meeting.location, meeting.client?.name]
                            .filter(Boolean)
                            .join(' | ')}
                          {disabled ? ` | ${disabledReason(meeting)}` : ''}
                        </small>
                      </button>
                    );
                  })
                ) : (
                  <Empty description={noMeetingsText} />
                )}
              </div>
            </div>
          ) : null}

          {workflow.step === 2 && selectedMeeting ? (
            <div className="outreach-flow-stack">
              <Typography.Title level={4}>{recipientsHeading(selectedMeeting)}</Typography.Title>
              {type === 'follow_up' ? (
                <Typography.Paragraph type="secondary">
                  Recipients are pre-populated from the meeting record. Add or remove as needed.
                </Typography.Paragraph>
              ) : null}
              <RecipientEditor workflow={workflow} onWorkflowChange={onWorkflowChange} />
              <div className="outreach-context-note">
                <RobotOutlined />
                <span>
                  Clio will draft from saved prep or debrief notes, client profile, participant
                  profiles, and linked meeting context available to this tenant.
                </span>
              </div>
            </div>
          ) : null}

          {workflow.step === 3 ? (
            <DraftStep
              heading={draftHeading}
              contextNote="Drafting from the selected meeting, saved notes, client context, and participant profiles."
              aiConfigured={aiConfigured}
              generating={generating}
              subject={workflow.subject}
              body={workflow.body}
              onGenerate={onGenerate}
              onSubject={(subject) => onWorkflowChange({ ...workflow, subject })}
              onBody={(body) => onWorkflowChange({ ...workflow, body })}
            />
          ) : null}

          {workflow.step === 4 ? (
            <div className="outreach-flow-stack">
              <Typography.Title level={4}>{readyHeading}</Typography.Title>
              <EmailPreview
                to={workflow.recipients.map((recipient) => recipient.email || recipient.name).join(', ')}
                subject={workflow.subject}
                body={workflow.body}
              />
              {!emailConnected ? (
                <div className="outreach-send-warning">
                  Connect your email in Settings to use this feature.
                </div>
              ) : null}
            </div>
          ) : null}
        </main>
      </div>
      <WorkflowFooter
        step={workflow.step}
        total={total}
        saving={saving}
        nextLabel={workflow.step === total ? 'Open in connected email' : workflow.step === 2 ? 'Review draft' : 'Continue'}
        nextLoading={opening}
        nextDisabled={
          (workflow.step === 1 && !workflow.meetingId) ||
          (workflow.step === 2 && workflow.recipients.length < 1) ||
          (workflow.step === 3 && (!workflow.subject.trim() || !workflow.body.trim())) ||
          (workflow.step === 4 && !emailConnected)
        }
        onBack={() => onWorkflowChange({ ...workflow, step: Math.max(1, workflow.step - 1) })}
        onNext={() => {
          if (workflow.step === total) {
            onOpenEmail();
            return;
          }
          void onSaveStep(workflow, workflow.step + 1);
        }}
      />
    </div>
  );
}

function RecipientEditor({
  workflow,
  onWorkflowChange,
}: {
  workflow: OutreachWorkflowState;
  onWorkflowChange: (value: OutreachWorkflowState) => void;
}) {
  return (
    <div className="outreach-recipient-editor">
      <RecipientTags
        recipients={workflow.recipients}
        onRemove={(recipient) =>
          onWorkflowChange({
            ...workflow,
            recipients: removeRecipient(workflow.recipients, recipient),
          })
        }
      />
      <Space.Compact>
        <Input
          value={workflow.recipientInput}
          placeholder="Name <email@example.com>"
          onChange={(event) =>
            onWorkflowChange({ ...workflow, recipientInput: event.target.value })
          }
          onPressEnter={() => {
            const parsed = parseRecipient(workflow.recipientInput);
            if (!parsed) return;
            onWorkflowChange({
              ...workflow,
              recipients: addUniqueRecipient(workflow.recipients, parsed),
              recipientInput: '',
            });
          }}
        />
        <Button
          onClick={() => {
            const parsed = parseRecipient(workflow.recipientInput);
            if (!parsed) return;
            onWorkflowChange({
              ...workflow,
              recipients: addUniqueRecipient(workflow.recipients, parsed),
              recipientInput: '',
            });
          }}
        >
          Add recipient
        </Button>
      </Space.Compact>
    </div>
  );
}

function DraftStep({
  heading,
  contextNote,
  aiConfigured,
  generating,
  subject,
  body,
  onGenerate,
  onSubject,
  onBody,
}: {
  heading: string;
  contextNote: string;
  aiConfigured: boolean;
  generating: boolean;
  subject: string;
  body: string;
  onGenerate: () => void;
  onSubject: (value: string) => void;
  onBody: (value: string) => void;
}) {
  return (
    <div className="outreach-flow-stack">
      <Typography.Title level={4}>{heading}</Typography.Title>
      <div className="outreach-context-note">
        <RobotOutlined />
        <span>{contextNote}</span>
      </div>
      <label>
        Subject line
        <Input value={subject} onChange={(event) => onSubject(event.target.value)} />
      </label>
      <div className="outreach-editor">
        <div className="outreach-editor-toolbar">
          {['{district}', '{committee}', '{member_priority}', '{personal_note}'].map((chip) => (
            <button key={chip} type="button" onClick={() => onBody(`${body}${body ? '\n' : ''}${chip}`)}>
              {chip}
            </button>
          ))}
          <Button
            size="small"
            icon={<RobotOutlined />}
            disabled={!aiConfigured}
            loading={generating}
            onClick={onGenerate}
          >
            Regenerate
          </Button>
        </div>
        <Input.TextArea
          rows={14}
          value={body}
          placeholder={
            aiConfigured
              ? 'Generate a Clio draft, then edit the email here.'
              : 'AI drafting is not configured. Set an OpenAI or Anthropic key to generate drafts.'
          }
          onChange={(event) => onBody(event.target.value)}
        />
      </div>
    </div>
  );
}

function WorkflowHeader({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <div className="outreach-workflow-head">
      <Typography.Title level={3}>{title}</Typography.Title>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  );
}

function WorkflowSteps({
  steps,
  current,
}: {
  steps: Array<[string, string]>;
  current: number;
}) {
  return (
    <aside className="outreach-steps">
      {steps.map(([title, description], index) => {
        const step = index + 1;
        return (
          <div className={step === current ? 'active' : step < current ? 'complete' : ''} key={title}>
            <span>{step < current ? <CheckOutlined /> : step}</span>
            <strong>{title}</strong>
            <small>{description}</small>
          </div>
        );
      })}
    </aside>
  );
}

function WorkflowFooter({
  step,
  total,
  saving,
  nextLabel,
  nextLoading,
  nextDisabled,
  onBack,
  onNext,
}: {
  step: number;
  total: number;
  saving: boolean;
  nextLabel: string;
  nextLoading?: boolean;
  nextDisabled?: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="outreach-workflow-footer">
      <Button disabled={step === 1 || saving} onClick={onBack}>
        Back
      </Button>
      <span>Step {step} of {total}</span>
      <div className="outreach-progress">
        <i style={{ width: `${(step / total) * 100}%` }} />
      </div>
      <Button type="primary" loading={saving || nextLoading} disabled={nextDisabled} onClick={onNext}>
        {nextLabel}
      </Button>
    </div>
  );
}

function DirectoryRecipientRow({
  entry,
  selected,
  onAdd,
}: {
  entry: DirectoryEntry;
  selected: boolean;
  onAdd: (recipient: OutreachRecipient) => void;
}) {
  const recipient: OutreachRecipient = {
    name: entry.fullName,
    email: entry.email || undefined,
    office: entry.office,
    title: entry.title,
    state: entry.state,
    district: entry.district,
    party: entry.partyName,
    directoryContactId: entry.id,
    directoryContactName: entry.fullName,
    committee: entry.committees[0],
    relevanceReason: [
      entry.committees[0],
      entry.focusAreas[0],
      entry.officeLocation ? `Office: ${entry.officeLocation}` : '',
    ]
      .filter(Boolean)
      .join(' | '),
  };

  return (
    <button type="button" className="outreach-directory-row" onClick={() => onAdd(recipient)}>
      <span>{initials(entry.memberName)}</span>
      <div>
        <strong>{entry.fullName}</strong>
        <small>{[entry.office, entry.committees[0]].filter(Boolean).join(' | ')}</small>
        <em>{recipient.relevanceReason}</em>
      </div>
      <Tag>{selected ? 'Selected' : 'Add'}</Tag>
    </button>
  );
}

function RecipientTags({
  recipients,
  onRemove,
}: {
  recipients: OutreachRecipient[];
  onRemove: (recipient: OutreachRecipient) => void;
}) {
  return (
    <div className="outreach-recipient-tags">
      {recipients.length ? (
        recipients.map((recipient) => (
          <Tag key={recipientKey(recipient)} closable onClose={() => onRemove(recipient)}>
            {recipient.name || recipient.email}
          </Tag>
        ))
      ) : (
        <Typography.Text type="secondary">No recipients selected yet.</Typography.Text>
      )}
    </div>
  );
}

function EmailPreview({ to, subject, body }: { to: string; subject: string; body: string }) {
  return (
    <div className="outreach-email-preview">
      <div>
        <strong>To</strong>
        <span>{to || 'Recipients'}</span>
      </div>
      <div>
        <strong>Subject</strong>
        <span>{subject || 'No subject'}</span>
      </div>
      <pre>{body || 'No body drafted yet.'}</pre>
    </div>
  );
}

function OutreachRecordCard({
  record,
  onClick,
}: {
  record: OutreachRecord;
  onClick: (record: OutreachRecord) => void;
}) {
  return (
    <button type="button" className="outreach-record-card" onClick={() => onClick(record)}>
      <Tag>{WORKFLOW_LABELS[record.type]}</Tag>
      <div>
        <strong>{record.title}</strong>
        <span>
          {[record.client?.name, record.meeting?.subject, `${record.recipientCount} recipients`, formatOptionalDate(record.sentAt ?? record.openedInEmailAt ?? record.createdAt)]
            .filter(Boolean)
            .join(' | ')}
        </span>
        <em>{recordStats(record)}</em>
      </div>
      <aside>
        <span>{statusLabel(record)}</span>
        <time>{formatOptionalDate(record.sentAt ?? record.openedInEmailAt ?? record.createdAt)}</time>
      </aside>
    </button>
  );
}

function OutreachReadonly({ record, onClose }: { record: OutreachRecord; onClose: () => void }) {
  return (
    <div className="outreach-workflow">
      <WorkflowHeader title={record.title} onCancel={onClose} />
      <div className="outreach-readonly">
        <Tag>{WORKFLOW_LABELS[record.type]}</Tag>
        <Typography.Text type="secondary">{recordStats(record)}</Typography.Text>
        <EmailPreview
          to={record.recipients.map((recipient) => recipient.email || recipient.name).join(', ')}
          subject={record.subject ?? ''}
          body={record.body ?? ''}
        />
      </div>
    </div>
  );
}

function workflowPayload(workflow: OutreachWorkflowState): Record<string, unknown> {
  const title =
    workflow.campaignName ||
    workflow.record?.title ||
    (workflow.meetingId ? 'Meeting outreach' : 'Outreach draft');
  return {
    title,
    clientId: workflow.clientId,
    meetingId: workflow.meetingId,
    subject: workflow.subject || null,
    body: workflow.body || null,
    recipients: workflow.recipients,
    lastStep: workflow.step,
    metadata: {
      campaignName: workflow.campaignName || null,
      objective: workflow.objective || null,
      selectedPreviewIndex: workflow.selectedPreviewIndex,
    },
  };
}

function hydrateWorkflowFromRecord(
  record: OutreachRecord,
  current: OutreachWorkflowState,
): OutreachWorkflowState {
  return {
    ...current,
    record,
    step: record.lastStep || current.step || 1,
    campaignName: readString(record.metadata?.campaignName) || record.title,
    objective: readString(record.metadata?.objective) || current.objective,
    clientId: record.clientId,
    meetingId: record.meetingId,
    recipients: normalizeRecipients(record.recipients),
    subject: record.subject ?? '',
    body: record.body ?? '',
    selectedPreviewIndex: Number(record.metadata?.selectedPreviewIndex ?? 0) || 0,
  };
}

function meetingRecipients(meeting: OutreachMeeting): OutreachRecipient[] {
  const rows: OutreachRecipient[] = [];
  if (meeting.organizerEmail || meeting.organizerName) {
    rows.push({
      name: meeting.organizerName ?? meeting.organizerEmail ?? undefined,
      email: meeting.organizerEmail ?? undefined,
      title: 'Organizer',
    });
  }
  for (const attendee of meeting.attendees) {
    rows.push({
      name: attendee.name ?? attendee.email ?? undefined,
      email: attendee.email ?? undefined,
      title: attendee.role ?? undefined,
    });
  }
  return normalizeRecipients(rows);
}

function addUniqueRecipient(recipients: OutreachRecipient[], recipient: OutreachRecipient) {
  const key = recipientKey(recipient);
  if (recipients.some((row) => recipientKey(row) === key)) return recipients;
  return [...recipients, recipient];
}

function removeRecipient(recipients: OutreachRecipient[], recipient: OutreachRecipient) {
  const key = recipientKey(recipient);
  return recipients.filter((row) => recipientKey(row) !== key);
}

function normalizeRecipients(value: unknown): OutreachRecipient[] {
  return Array.isArray(value)
    ? value
        .map((entry) => (entry && typeof entry === 'object' ? (entry as OutreachRecipient) : null))
        .filter((entry): entry is OutreachRecipient => Boolean(entry?.name || entry?.email))
    : [];
}

function parseRecipient(value: string): OutreachRecipient | null {
  const text = value.trim();
  if (!text) return null;
  const angle = text.match(/^(.*)<([^>]+)>$/);
  if (angle) return { name: angle[1]?.trim(), email: angle[2]?.trim() };
  if (text.includes('@')) return { email: text };
  return { name: text };
}

function recipientKey(recipient: OutreachRecipient): string {
  return (
    recipient.email?.toLowerCase() ||
    recipient.directoryContactId ||
    recipient.name?.toLowerCase() ||
    JSON.stringify(recipient)
  );
}

function personalizedPreview(recipient: OutreachRecipient): string {
  return [recipient.committee, recipient.state, recipient.relevanceReason].filter(Boolean).join(' | ');
}

function assembleCampaignBody(body: string, recipient: OutreachRecipient | null): string {
  if (!recipient) return body;
  return body
    .replaceAll('{district}', recipient.district || recipient.state || '')
    .replaceAll('{committee}', recipient.committee || '')
    .replaceAll('{member_priority}', recipient.relevanceReason || '')
    .replaceAll('{personal_note}', recipient.personalNote || '');
}

function recordStats(record: OutreachRecord): string {
  if (record.type === 'campaign') {
    const openRate = readString(record.stats?.openRate) || '0%';
    const replies = readString(record.stats?.replyCount) || '0';
    return record.status === 'sent'
      ? `${record.recipientCount} sent | ${openRate} opened | ${replies} replied`
      : `${record.recipientCount} recipients | Clio draft ${record.subject ? 'ready' : 'pending'}`;
  }
  if (record.status === 'opened_in_email') {
    return `Opened in connected email | ${formatOptionalDate(record.openedInEmailAt)}`;
  }
  return `${record.recipientCount} recipients`;
}

function statusLabel(record: OutreachRecord): string {
  if (record.status === 'draft') return 'Draft';
  if (record.status === 'sent') return 'Sent';
  if (record.status === 'opened_in_email') return 'Opened in email';
  return 'Failed';
}

function objectiveSearchSeed(client: Client): string {
  const intake = client.intakeData ?? {};
  const portfolio = Array.isArray(intake.portfolio) ? intake.portfolio[0] : '';
  return [portfolio, intake.requestType, intake.sector, client.name].filter(Boolean).join(' ');
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join('') || 'C';
}

function todayInputValue(): string {
  return inputValueFromDate(new Date());
}

function inputValueFromDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localDateStartIso(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const fallback = new Date();
  return new Date(
    year ?? fallback.getFullYear(),
    (month ?? fallback.getMonth() + 1) - 1,
    day ?? fallback.getDate(),
    0,
    0,
    0,
    0,
  ).toISOString();
}

function localDateEndIso(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const fallback = new Date();
  return new Date(
    year ?? fallback.getFullYear(),
    (month ?? fallback.getMonth() + 1) - 1,
    day ?? fallback.getDate(),
    23,
    59,
    59,
    999,
  ).toISOString();
}

function formatOptionalDate(value?: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}
