import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExportOutlined,
  FileTextOutlined,
  LockOutlined,
  MailOutlined,
  PlusOutlined,
  RobotOutlined,
  SyncOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Empty, Form, Input, Modal, Select, Space, Tabs, Tag, Typography } from 'antd';
import { GlobalClientPicker } from '../../components/GlobalClientPicker.js';
import { useApi } from '../../lib/use-api.js';
import { useClientFilter } from '../../state/client-filter.js';
import type { Client } from '../clients/clientTypes.js';

interface EngagementCapabilities {
  ai: { activeProvider: 'openai' | 'anthropic' | null };
  notes: { encryptedNotesConfigured: boolean };
  attachments: { s3Configured: boolean; maxBytes: number };
}

interface IntegrationConnection {
  id: string;
  provider: 'microsoft_365' | 'google_workspace' | 'imap_caldav' | 'manual';
  accountEmail: string | null;
  displayName: string | null;
  status: 'needs_configuration' | 'connected' | 'error' | 'disabled';
  lastSyncAt: string | null;
}

interface MeetingAttendee {
  id: string;
  email: string | null;
  name: string | null;
  role: string | null;
}

interface MeetingPrep {
  id: string;
  agenda: string[];
  talkingPoints: string[];
  risks: string[];
  followUps: string[];
  summary: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

interface Meeting {
  id: string;
  subject: string;
  source: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  organizerEmail: string | null;
  organizerName: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  associationScore: number | null;
  associationReason: string | null;
  client: Pick<
    Client,
    'id' | 'name' | 'website' | 'primaryContactName' | 'primaryContactEmail'
  > | null;
  attendees: MeetingAttendee[];
  preps: MeetingPrep[];
  notes: MeetingNoteSummary[];
}

interface MeetingNoteSummary {
  id: string;
  confidential: boolean;
  accessLevel?: string;
  authorUserId?: string | null;
  author?: NoteAuthor | null;
  createdAt: string;
}

interface MeetingNote extends MeetingNoteSummary {
  body: string | null;
  restricted: boolean;
  updatedAt: string;
}

interface NoteAuthor {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

interface EngagementTask {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'blocked' | 'canceled';
  client: Pick<Client, 'id' | 'name'> | null;
  meeting: { id: string; subject: string } | null;
}

interface MailThread {
  id: string;
  subject: string;
  source: string;
  snippet: string | null;
  lastMessageAt: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  client: Pick<Client, 'id' | 'name'> | null;
  messages: Array<{
    id: string;
    fromEmail: string | null;
    receivedAt: string | null;
    metadata: Record<string, unknown> | null;
  }>;
}

interface ClientContext {
  recentActivity: Array<{ type: string; id: string; title: string; date: string }>;
  keyStakeholders: Array<{
    id: string;
    email: string | null;
    fullName: string | null;
    title: string | null;
    organization: string | null;
  }>;
  openThreads: Array<{
    id: string;
    subject: string;
    snippet: string | null;
    lastMessageAt: string | null;
  }>;
  openTasks: EngagementTask[];
  summary: {
    meetings: number;
    mailThreads: number;
    contacts: number;
    openTasks: number;
    rag: string;
  };
}

interface MeetingFormValues {
  clientId?: string;
  subject: string;
  date: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  description?: string;
  attendeesText?: string;
}

interface TaskFormValues {
  title: string;
  description?: string;
  dueDate?: string;
}

export function EngagementPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { selectedClientId } = useClientFilter();
  const [date, setDate] = useState(todayInputValue());
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [meetingDetailTab, setMeetingDetailTab] = useState('prep');
  const [meetingViewMode, setMeetingViewMode] = useState<'list' | 'calendar'>('list');
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [meetingForm] = Form.useForm<MeetingFormValues>();
  const [taskForm] = Form.useForm<TaskFormValues>();
  const [noteForm] = Form.useForm<{ body: string }>();

  const window = useMemo(() => dateWindow(date), [date]);

  const clients = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Client[]>('/api/clients')).data,
  });

  const capabilities = useQuery<EngagementCapabilities>({
    queryKey: ['engagement-capabilities'],
    queryFn: async () =>
      (await api.get<EngagementCapabilities>('/api/engagement/capabilities')).data,
  });

  const integrations = useQuery<IntegrationConnection[]>({
    queryKey: ['engagement-integrations'],
    queryFn: async () =>
      (await api.get<IntegrationConnection[]>('/api/engagement/integrations')).data,
  });

  const meetings = useQuery<Meeting[]>({
    queryKey: ['engagement-meetings', selectedClientId, window.from, window.to],
    queryFn: async () =>
      (
        await api.get<Meeting[]>('/api/engagement/meetings', {
          params: { clientId: selectedClientId ?? undefined, from: window.from, to: window.to },
        })
      ).data,
  });

  const selectedMeeting = useMemo(
    () => (meetings.data ?? []).find((meeting) => meeting.id === selectedMeetingId) ?? null,
    [meetings.data, selectedMeetingId],
  );
  const contextClientId = selectedClientId ?? selectedMeeting?.client?.id ?? null;

  useEffect(() => {
    const rows = meetings.data ?? [];
    if (!rows.length) {
      setSelectedMeetingId(null);
      return;
    }
    if (!selectedMeetingId || !rows.some((meeting) => meeting.id === selectedMeetingId)) {
      setSelectedMeetingId(rows[0]?.id ?? null);
    }
  }, [meetings.data, selectedMeetingId]);

  const clientContext = useQuery<ClientContext>({
    queryKey: ['engagement-client-context', contextClientId],
    queryFn: async () =>
      (await api.get<ClientContext>(`/api/engagement/context/${contextClientId}`)).data,
    enabled: Boolean(contextClientId),
  });

  const meetingNotes = useQuery<MeetingNote[]>({
    queryKey: ['engagement-meeting-notes', selectedMeeting?.id],
    queryFn: async () =>
      (await api.get<MeetingNote[]>(`/api/engagement/meetings/${selectedMeeting?.id}/notes`)).data,
    enabled: Boolean(selectedMeeting?.id),
  });

  const tasks = useQuery<EngagementTask[]>({
    queryKey: ['engagement-tasks', selectedClientId],
    queryFn: async () =>
      (
        await api.get<EngagementTask[]>('/api/engagement/tasks', {
          params: { clientId: selectedClientId ?? undefined },
        })
      ).data,
  });

  const mailThreads = useQuery<MailThread[]>({
    queryKey: ['engagement-mail-threads', selectedClientId],
    queryFn: async () =>
      (
        await api.get<MailThread[]>('/api/engagement/mail-threads', {
          params: { clientId: selectedClientId ?? undefined },
        })
      ).data,
  });

  const syncOutlookDay = useMutation({
    mutationFn: async () => {
      const connections = (integrations.data ?? []).filter(
        (connection) =>
          connection.provider === 'microsoft_365' && connection.status === 'connected',
      );
      if (!connections.length) throw new Error('Connect Microsoft 365 before syncing Outlook.');

      for (const connection of connections) {
        await api.post(
          `/api/engagement/integrations/microsoft/${connection.id}/calendar-window`,
          undefined,
          { params: { from: window.from, to: window.to } },
        );
        await api.post(`/api/engagement/integrations/microsoft/${connection.id}/sync`, undefined, {
          params: { calendar: 'false', mail: 'true' },
        });
      }
    },
    onSuccess: () => {
      message.success('Outlook schedule refreshed');
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-mail-threads'] });
      qc.invalidateQueries({ queryKey: ['engagement-client-context'] });
      qc.invalidateQueries({ queryKey: ['client-meetings'] });
      qc.invalidateQueries({ queryKey: ['client-mail-threads'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const createMeeting = useMutation({
    mutationFn: async (values: MeetingFormValues) =>
      (
        await api.post('/api/engagement/meetings', {
          clientId: values.clientId || selectedClientId || undefined,
          subject: values.subject,
          description: optionalText(values.description),
          location: optionalText(values.location),
          startsAt: localDateTimeToIso(values.date, values.startsAt),
          endsAt: localDateTimeToIso(values.date, values.endsAt),
          attendees: parseAttendees(values.attendeesText),
        })
      ).data,
    onSuccess: () => {
      message.success('Meeting saved');
      setMeetingModalOpen(false);
      meetingForm.resetFields();
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-tasks'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const createTask = useMutation({
    mutationFn: async (values: TaskFormValues) =>
      (
        await api.post('/api/engagement/tasks', {
          clientId: selectedClientId ?? undefined,
          title: values.title,
          description: optionalText(values.description),
          dueDate: values.dueDate ? localDateTimeToIso(values.dueDate, '12:00') : undefined,
        })
      ).data,
    onSuccess: () => {
      message.success('Task saved');
      setTaskModalOpen(false);
      taskForm.resetFields();
      qc.invalidateQueries({ queryKey: ['engagement-tasks'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const updateTaskStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: EngagementTask['status'] }) =>
      (await api.patch(`/api/engagement/tasks/${id}`, { status })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engagement-tasks'] }),
    onError: (err) => message.error(errorMessage(err)),
  });

  const generatePrep = useMutation({
    mutationFn: async (meetingId: string) =>
      (await api.post(`/api/engagement/meetings/${meetingId}/prep`)).data,
    onSuccess: () => {
      message.success('Meeting prep generated');
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-client-context'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const createNote = useMutation({
    mutationFn: async ({ meetingId, body }: { meetingId: string; body: string }) =>
      (
        await api.post(`/api/engagement/meetings/${meetingId}/notes`, {
          body,
          confidential: true,
          accessLevel: 'tenant_members',
        })
      ).data,
    onSuccess: () => {
      message.success('Encrypted note saved');
      noteForm.resetFields();
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-meeting-notes'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const activeClient = clients.data?.find((client) => client.id === selectedClientId);

  return (
    <section className="engagement-page">
      <div className="engagement-hero">
        <div>
          <Typography.Title level={3}>Engagement Manager</Typography.Title>
          <Typography.Text>
            {activeClient ? activeClient.name : 'All clients'} · {formatLongDate(window.from)}
          </Typography.Text>
        </div>
        <Space wrap>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <Button
            icon={<SyncOutlined />}
            loading={syncOutlookDay.isPending}
            onClick={() => syncOutlookDay.mutate()}
          >
            Sync Outlook
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => setTaskModalOpen(true)}>
            Task
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              meetingForm.setFieldsValue({
                date,
                startsAt: '09:00',
                endsAt: '09:30',
                clientId: selectedClientId ?? undefined,
              });
              setMeetingModalOpen(true);
            }}
          >
            Meeting
          </Button>
        </Space>
      </div>

      <GlobalClientPicker />

      <Tabs
        className="engagement-tabs"
        defaultActiveKey="meetings"
        items={[
          {
            key: 'meetings',
            label: 'Meetings',
            children: (
              <div className="engagement-meeting-shell">
                <div className="engagement-panel engagement-schedule-panel">
                  <div className="engagement-schedule-head">
                    <PanelTitle icon={<CalendarOutlined />} title={formatMeetingDay(window.from)} />
                    <div className="engagement-view-toggle" aria-label="Meeting view">
                      <button
                        type="button"
                        className={meetingViewMode === 'list' ? 'active' : ''}
                        onClick={() => setMeetingViewMode('list')}
                      >
                        List
                      </button>
                      <button
                        type="button"
                        className={meetingViewMode === 'calendar' ? 'active' : ''}
                        onClick={() => setMeetingViewMode('calendar')}
                      >
                        Calendar
                      </button>
                    </div>
                  </div>

                  {meetings.isLoading ? (
                    <Empty description="Loading Outlook meetings..." />
                  ) : meetings.data?.length ? (
                    meetingViewMode === 'list' ? (
                      <div className="engagement-agenda-list">
                        {meetings.data.map((meeting) => (
                          <MeetingListItem
                            key={meeting.id}
                            meeting={meeting}
                            selected={meeting.id === selectedMeeting?.id}
                            aiConfigured={Boolean(capabilities.data?.ai.activeProvider)}
                            generating={generatePrep.isPending}
                            onSelect={() => {
                              setSelectedMeetingId(meeting.id);
                              setMeetingDetailTab(meeting.preps[0] ? 'prep' : 'intel');
                            }}
                            onGeneratePrep={() => generatePrep.mutate(meeting.id)}
                          />
                        ))}
                      </div>
                    ) : (
                      <MeetingCalendarList
                        meetings={meetings.data}
                        selectedId={selectedMeeting?.id ?? null}
                        onSelect={setSelectedMeetingId}
                      />
                    )
                  ) : (
                    <Empty description="No Outlook meetings for this date." />
                  )}
                </div>

                <MeetingDetailPanel
                  meeting={selectedMeeting}
                  context={clientContext.data}
                  contextLoading={clientContext.isLoading}
                  notes={meetingNotes.data ?? []}
                  notesLoading={meetingNotes.isLoading}
                  activeTab={meetingDetailTab}
                  onTabChange={setMeetingDetailTab}
                  noteForm={noteForm}
                  notesConfigured={Boolean(capabilities.data?.notes.encryptedNotesConfigured)}
                  aiConfigured={Boolean(capabilities.data?.ai.activeProvider)}
                  generating={generatePrep.isPending}
                  savingNote={createNote.isPending}
                  onGeneratePrep={(meeting) => generatePrep.mutate(meeting.id)}
                  onCreateNote={(meeting, body) =>
                    createNote.mutate({ meetingId: meeting.id, body })
                  }
                />
              </div>
            ),
          },
          {
            key: 'calendar',
            label: 'Calendar',
            children: <CalendarView meetings={meetings.data ?? []} />,
          },
          {
            key: 'mail',
            label: 'Mail',
            children: <MailView threads={mailThreads.data ?? []} />,
          },
          {
            key: 'reports',
            label: 'Reports',
            children: (
              <div className="engagement-panel engagement-muted-panel">
                <PanelTitle icon={<FileTextOutlined />} title="Reports" />
                <Empty description="Reports will activate after synced engagement history exists." />
              </div>
            ),
          },
        ]}
      />

      <Modal
        title="New meeting"
        open={meetingModalOpen}
        onCancel={() => setMeetingModalOpen(false)}
        onOk={() => meetingForm.submit()}
        confirmLoading={createMeeting.isPending}
        width={680}
      >
        <Form
          form={meetingForm}
          layout="vertical"
          onFinish={(values) => createMeeting.mutate(values)}
        >
          <Form.Item name="subject" label="Subject" rules={[{ required: true, min: 1 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="clientId" label="Client">
            <Select
              allowClear
              options={(clients.data ?? [])
                .filter((client) => client.status !== 'archived')
                .map((client) => ({ value: client.id, label: client.name }))}
            />
          </Form.Item>
          <div className="engagement-form-grid">
            <Form.Item name="date" label="Date" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="startsAt" label="Start" rules={[{ required: true }]}>
              <Input type="time" />
            </Form.Item>
            <Form.Item name="endsAt" label="End" rules={[{ required: true }]}>
              <Input type="time" />
            </Form.Item>
          </div>
          <Form.Item name="location" label="Location">
            <Input />
          </Form.Item>
          <Form.Item name="attendeesText" label="Attendees">
            <Input.TextArea rows={3} placeholder="Jane Smith <jane@example.com>" />
          </Form.Item>
          <Form.Item name="description" label="Details">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="New task"
        open={taskModalOpen}
        onCancel={() => setTaskModalOpen(false)}
        onOk={() => taskForm.submit()}
        confirmLoading={createTask.isPending}
      >
        <Form form={taskForm} layout="vertical" onFinish={(values) => createTask.mutate(values)}>
          <Form.Item name="title" label="Title" rules={[{ required: true, min: 1 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="dueDate" label="Due date">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

function MeetingListItem({
  meeting,
  selected,
  aiConfigured,
  generating,
  onSelect,
  onGeneratePrep,
}: {
  meeting: Meeting;
  selected: boolean;
  aiConfigured: boolean;
  generating: boolean;
  onSelect: () => void;
  onGeneratePrep: () => void;
}) {
  const prep = meeting.preps[0];
  return (
    <article
      className={`engagement-agenda-item${selected ? ' selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect();
      }}
    >
      <div className="engagement-agenda-time">{formatTime(meeting.startsAt)}</div>
      <div className="engagement-agenda-marker" />
      <div className="engagement-agenda-body">
        <Typography.Text strong>{meeting.subject}</Typography.Text>
        <Typography.Text type="secondary">
          {[meeting.client?.name, meeting.location, sourceLabel(meeting.source)]
            .filter(Boolean)
            .join(' | ')}
        </Typography.Text>
        <div className="engagement-agenda-tags">
          {prep ? <Tag>Prepped</Tag> : null}
          {meeting.client ? <Tag>{meeting.client.name}</Tag> : <Tag>Unlinked</Tag>}
          {meeting.attendees.length ? <Tag>{meeting.attendees.length} participants</Tag> : null}
        </div>
      </div>
      <Button
        size="small"
        disabled={!aiConfigured}
        loading={generating}
        onClick={(event) => {
          event.stopPropagation();
          onGeneratePrep();
        }}
      >
        {prep ? 'Regenerate prep' : 'Generate prep'}
      </Button>
    </article>
  );
}

function MeetingCalendarList({
  meetings,
  selectedId,
  onSelect,
}: {
  meetings: Meeting[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="engagement-day-calendar">
      {meetings.map((meeting) => (
        <button
          key={meeting.id}
          type="button"
          className={meeting.id === selectedId ? 'selected' : ''}
          onClick={() => onSelect(meeting.id)}
        >
          <span>{formatTime(meeting.startsAt)}</span>
          <strong>{meeting.subject}</strong>
          <small>{[meeting.client?.name, meeting.location].filter(Boolean).join(' | ')}</small>
        </button>
      ))}
    </div>
  );
}

function MeetingDetailPanel({
  meeting,
  context,
  contextLoading,
  notes,
  notesLoading,
  activeTab,
  onTabChange,
  noteForm,
  notesConfigured,
  aiConfigured,
  generating,
  savingNote,
  onGeneratePrep,
  onCreateNote,
}: {
  meeting: Meeting | null;
  context?: ClientContext;
  contextLoading: boolean;
  notes: MeetingNote[];
  notesLoading: boolean;
  activeTab: string;
  onTabChange: (key: string) => void;
  noteForm: ReturnType<typeof Form.useForm<{ body: string }>>[0];
  notesConfigured: boolean;
  aiConfigured: boolean;
  generating: boolean;
  savingNote: boolean;
  onGeneratePrep: (meeting: Meeting) => void;
  onCreateNote: (meeting: Meeting, body: string) => void;
}) {
  if (!meeting) {
    return (
      <div className="engagement-panel engagement-detail-panel">
        <Empty description="Select a meeting to view prep, notes, and client context." />
      </div>
    );
  }

  const prep = meeting.preps[0];
  const participants = meetingParticipants(meeting);

  return (
    <aside className="engagement-panel engagement-detail-panel">
      <div className="engagement-detail-head">
        <div>
          <Typography.Title level={5}>{meeting.subject}</Typography.Title>
          <Typography.Text type="secondary">
            {[
              formatTimeRange(meeting.startsAt, meeting.endsAt),
              meeting.location,
              meeting.client?.name,
            ]
              .filter(Boolean)
              .join(' | ')}
          </Typography.Text>
        </div>
        <Button
          size="small"
          icon={<ExportOutlined />}
          disabled={!openUrl(meeting)}
          href={openUrl(meeting)}
          target="_blank"
          rel="noreferrer"
        >
          Open
        </Button>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={onTabChange}
        className="engagement-detail-tabs"
        items={[
          {
            key: 'prep',
            label: 'Prep',
            children: (
              <div className="engagement-detail-stack">
                {prep ? (
                  <>
                    <DetailBlock title="Context">
                      <Typography.Paragraph>
                        {prep.summary || contextSummary(context, contextLoading)}
                      </Typography.Paragraph>
                    </DetailBlock>
                    <DetailBlock title="Agenda">
                      <BulletList items={prep.agenda} empty="No agenda generated yet." />
                    </DetailBlock>
                    <DetailBlock title="Talking Points">
                      <BulletList
                        items={prep.talkingPoints}
                        empty="No talking points generated yet."
                      />
                    </DetailBlock>
                  </>
                ) : (
                  <div className="engagement-empty-prep">
                    <RobotOutlined />
                    <Typography.Text strong>
                      Prep has not been generated for this meeting.
                    </Typography.Text>
                    <Button
                      type="primary"
                      disabled={!aiConfigured}
                      loading={generating}
                      onClick={() => onGeneratePrep(meeting)}
                    >
                      Generate agenda and talking points
                    </Button>
                  </div>
                )}
                <ParticipantsList participants={participants} />
              </div>
            ),
          },
          {
            key: 'notes',
            label: 'Notes',
            children: (
              <div className="engagement-detail-stack">
                <Form
                  form={noteForm}
                  layout="vertical"
                  onFinish={(values) => onCreateNote(meeting, values.body)}
                >
                  <Form.Item
                    name="body"
                    label="Confidential meeting notes"
                    rules={[{ required: true, min: 1 }]}
                  >
                    <Input.TextArea
                      rows={7}
                      placeholder="Capture decisions, commitments, follow-ups, and sensitive context..."
                      disabled={!notesConfigured}
                    />
                  </Form.Item>
                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<LockOutlined />}
                    loading={savingNote}
                    disabled={!notesConfigured}
                  >
                    Save encrypted note
                  </Button>
                  {!notesConfigured ? (
                    <Typography.Text type="secondary">
                      Encrypted notes require NOTES_ENCRYPTION_KEY on the API.
                    </Typography.Text>
                  ) : null}
                </Form>

                <div className="engagement-note-history">
                  <Typography.Text strong>Previous notes</Typography.Text>
                  {notesLoading ? (
                    <Typography.Text type="secondary">Loading notes...</Typography.Text>
                  ) : notes.length ? (
                    notes.map((note) => (
                      <article className="engagement-note-entry" key={note.id}>
                        <div>
                          <Typography.Text strong>{noteAuthor(note)}</Typography.Text>
                          <Typography.Text type="secondary">
                            {formatDateTime(note.createdAt)}
                          </Typography.Text>
                        </div>
                        <Typography.Paragraph>
                          {note.restricted
                            ? 'This confidential note is restricted to its author and tenant admins.'
                            : note.body}
                        </Typography.Paragraph>
                      </article>
                    ))
                  ) : (
                    <Typography.Text type="secondary">No notes captured yet.</Typography.Text>
                  )}
                </div>

                <div className="engagement-transcript-disabled">
                  <LockOutlined />
                  <div>
                    <Typography.Text strong>Transcripts</Typography.Text>
                    <Typography.Text type="secondary">
                      Transcript upload and transcription capture are disabled for now.
                    </Typography.Text>
                  </div>
                </div>
              </div>
            ),
          },
          {
            key: 'debrief',
            label: 'Debrief',
            disabled: true,
            children: null,
          },
          {
            key: 'intel',
            label: 'Intel',
            children: (
              <ClientIntelPanel context={context} loading={contextLoading} meeting={meeting} />
            ),
          },
        ]}
      />
    </aside>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="engagement-detail-block">
      <Typography.Text strong>{title}</Typography.Text>
      {children}
    </section>
  );
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <Typography.Text type="secondary">{empty}</Typography.Text>;
  return (
    <ul className="engagement-bullet-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ParticipantsList({ participants }: { participants: MeetingParticipant[] }) {
  return (
    <DetailBlock title="Participants">
      {participants.length ? (
        <div className="engagement-participant-list">
          {participants.map((participant) => (
            <div className="engagement-participant-row" key={participant.key}>
              <span className="engagement-participant-avatar">{initials(participant.name)}</span>
              <div>
                <Typography.Text strong>{participant.name}</Typography.Text>
                <Typography.Text type="secondary">
                  {[participant.role, participant.email].filter(Boolean).join(' | ')}
                </Typography.Text>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Typography.Text type="secondary">
          No participants were included in the invite.
        </Typography.Text>
      )}
    </DetailBlock>
  );
}

function ClientIntelPanel({
  context,
  loading,
  meeting,
}: {
  context?: ClientContext;
  loading: boolean;
  meeting: Meeting;
}) {
  if (!meeting.client) {
    return (
      <Empty description="Link this meeting to a client to gather client-specific mail, meeting, and stakeholder context." />
    );
  }
  if (loading) return <Typography.Text type="secondary">Loading client context...</Typography.Text>;
  if (!context) return <Empty description="No client context available yet." />;

  return (
    <div className="engagement-detail-stack">
      <div className="engagement-context-metrics">
        <MetricPill label="Meetings" value={context.summary.meetings} />
        <MetricPill label="Mail threads" value={context.summary.mailThreads} />
        <MetricPill label="Contacts" value={context.summary.contacts} />
        <MetricPill label="Open tasks" value={context.summary.openTasks} />
      </div>
      <DetailBlock title="Recent Activity">
        <div className="engagement-intel-list">
          {context.recentActivity.slice(0, 6).map((activity) => (
            <div key={`${activity.type}-${activity.id}`}>
              <Typography.Text>{activity.title}</Typography.Text>
              <Typography.Text type="secondary">
                {[activity.type.replace(/_/g, ' '), formatOptionalDate(activity.date)]
                  .filter(Boolean)
                  .join(' | ')}
              </Typography.Text>
            </div>
          ))}
        </div>
      </DetailBlock>
      <DetailBlock title="Key Stakeholders">
        <div className="engagement-intel-list">
          {context.keyStakeholders.slice(0, 6).map((stakeholder) => (
            <div key={stakeholder.id}>
              <Typography.Text>
                {stakeholder.fullName || stakeholder.email || 'Unknown contact'}
              </Typography.Text>
              <Typography.Text type="secondary">
                {[stakeholder.title, stakeholder.organization, stakeholder.email]
                  .filter(Boolean)
                  .join(' | ')}
              </Typography.Text>
            </div>
          ))}
        </div>
      </DetailBlock>
      <DetailBlock title="Open Threads">
        <div className="engagement-intel-list">
          {context.openThreads.slice(0, 5).map((thread) => (
            <div key={thread.id}>
              <Typography.Text>{thread.subject}</Typography.Text>
              <Typography.Text type="secondary">
                {formatOptionalDate(thread.lastMessageAt)}
              </Typography.Text>
            </div>
          ))}
        </div>
      </DetailBlock>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="engagement-context-pill">
      <Typography.Text strong>{value}</Typography.Text>
      <Typography.Text type="secondary">{label}</Typography.Text>
    </div>
  );
}

interface MeetingParticipant {
  key: string;
  name: string;
  email: string | null;
  role: string | null;
}

function meetingParticipants(meeting: Meeting): MeetingParticipant[] {
  const rows: MeetingParticipant[] = [];
  if (meeting.organizerName || meeting.organizerEmail) {
    rows.push({
      key: `organizer-${meeting.organizerEmail ?? meeting.organizerName}`,
      name: meeting.organizerName || meeting.organizerEmail || 'Organizer',
      email: meeting.organizerEmail,
      role: 'Organizer',
    });
  }
  for (const attendee of meeting.attendees) {
    rows.push({
      key: attendee.id,
      name: attendee.name || attendee.email || 'Unknown participant',
      email: attendee.email,
      role: attendee.role,
    });
  }
  return rows;
}

function MeetingCard({
  meeting,
  aiConfigured,
  notesConfigured,
  generating,
  onGeneratePrep,
  onAddNote,
}: {
  meeting: Meeting;
  aiConfigured: boolean;
  notesConfigured: boolean;
  generating: boolean;
  onGeneratePrep: () => void;
  onAddNote: () => void;
}) {
  const prep = meeting.preps[0];
  return (
    <article className="engagement-meeting-card">
      <div className="engagement-meeting-top">
        <div className="engagement-time-badge">
          <Typography.Text strong>{formatTime(meeting.startsAt)}</Typography.Text>
          <Typography.Text type="secondary">{formatTime(meeting.endsAt)}</Typography.Text>
        </div>
        <div>
          <Typography.Title level={5}>{meeting.subject}</Typography.Title>
          <Typography.Text type="secondary">
            {meeting.client?.name ?? 'Unlinked client'} · {meeting.location || 'No location'}
          </Typography.Text>
        </div>
        <Tag color={confidenceColor(meeting.associationScore)}>
          {meeting.associationScore == null
            ? 'manual'
            : `${Math.round(meeting.associationScore * 100)}%`}
        </Tag>
      </div>

      <div className="engagement-card-meta">
        <span>
          <TeamOutlined /> {meeting.attendees.length} attendees
        </span>
        <span>
          <FileTextOutlined /> {meeting.notes.length} notes
        </span>
        <span>
          <RobotOutlined /> {prep ? 'prep ready' : 'prep pending'}
        </span>
      </div>

      {meeting.associationReason ? (
        <Typography.Paragraph className="engagement-reason">
          {meeting.associationReason}
        </Typography.Paragraph>
      ) : null}

      {prep ? (
        <div className="engagement-prep-box">
          <Typography.Text strong>{prep.summary || 'Meeting prep'}</Typography.Text>
          <ul>
            {prep.talkingPoints.slice(0, 3).map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Space wrap>
        <Button
          icon={<ExportOutlined />}
          disabled={!openUrl(meeting)}
          href={openUrl(meeting)}
          target="_blank"
          rel="noreferrer"
        >
          Open in Outlook
        </Button>
        <Button
          icon={<RobotOutlined />}
          disabled={!aiConfigured}
          loading={generating}
          onClick={onGeneratePrep}
        >
          Generate prep
        </Button>
        <Button icon={<FileTextOutlined />} disabled={!notesConfigured} onClick={onAddNote}>
          Add note
        </Button>
      </Space>
    </article>
  );
}

function TaskPanel({
  tasks,
  updating,
  onDone,
}: {
  tasks: EngagementTask[];
  updating: boolean;
  onDone: (task: EngagementTask) => void;
}) {
  return (
    <div className="engagement-panel">
      <PanelTitle icon={<CheckCircleOutlined />} title="Follow-ups" />
      {tasks.length ? (
        <div className="engagement-task-list">
          {tasks.map((task) => (
            <div className="engagement-task-row" key={task.id}>
              <div>
                <Typography.Text strong>{task.title}</Typography.Text>
                <Typography.Text type="secondary">
                  {[task.client?.name, task.meeting?.subject, formatOptionalDate(task.dueDate)]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography.Text>
              </div>
              <Button
                size="small"
                disabled={task.status === 'done' || updating}
                onClick={() => onDone(task)}
              >
                Done
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <Empty description="No open follow-ups." />
      )}
    </div>
  );
}

function CalendarView({ meetings }: { meetings: Meeting[] }) {
  return (
    <div className="engagement-panel">
      <PanelTitle icon={<ClockCircleOutlined />} title="Calendar" />
      {meetings.length ? (
        <div className="engagement-calendar-list">
          {meetings.map((meeting) => (
            <div className="engagement-calendar-row" key={meeting.id}>
              <span>{formatTime(meeting.startsAt)}</span>
              <div>
                <Typography.Text strong>{meeting.subject}</Typography.Text>
                <Typography.Text type="secondary">
                  {meeting.client?.name ?? 'Unlinked'} · {meeting.location || 'No location'}
                </Typography.Text>
              </div>
              <Button
                size="small"
                icon={<ExportOutlined />}
                disabled={!openUrl(meeting)}
                href={openUrl(meeting)}
                target="_blank"
                rel="noreferrer"
              >
                Open
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <Empty description="No calendar items for this date." />
      )}
    </div>
  );
}

function MailView({ threads }: { threads: MailThread[] }) {
  return (
    <div className="engagement-panel">
      <PanelTitle icon={<MailOutlined />} title="Mail" />
      {threads.length ? (
        <div className="engagement-thread-list">
          {threads.map((thread) => (
            <div className="engagement-thread-row" key={thread.id}>
              <div>
                <Typography.Text strong>{thread.subject}</Typography.Text>
                <Typography.Text type="secondary">
                  {[thread.client?.name, formatOptionalDate(thread.lastMessageAt), thread.status]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography.Text>
                {thread.snippet ? (
                  <Typography.Paragraph>{thread.snippet}</Typography.Paragraph>
                ) : null}
              </div>
              <Button
                size="small"
                icon={<ExportOutlined />}
                disabled={!openUrl(thread)}
                href={openUrl(thread)}
                target="_blank"
                rel="noreferrer"
              >
                Open
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <Empty description="No synced email threads yet." />
      )}
    </div>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="engagement-panel-title">
      {icon}
      <Typography.Title level={5}>{title}</Typography.Title>
    </div>
  );
}

function formatMeetingDay(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function sourceLabel(source: string): string {
  if (source === 'outlook') return 'Outlook';
  if (source === 'google') return 'Google';
  if (source === 'manual') return 'Manual';
  return source.replace(/_/g, ' ');
}

function contextSummary(context: ClientContext | undefined, loading: boolean): string {
  if (loading) return 'Gathering client-specific Outlook context...';
  if (!context) return 'No synced client context is available yet.';
  return [
    `${context.summary.meetings} recent meetings`,
    `${context.summary.mailThreads} relevant mail threads`,
    `${context.summary.contacts} known stakeholders`,
    `${context.summary.openTasks} open follow-ups`,
  ].join(' | ');
}

function noteAuthor(note: MeetingNote | MeetingNoteSummary): string {
  const author = note.author;
  const name = [author?.firstName, author?.lastName].filter(Boolean).join(' ').trim();
  return name || author?.email || 'Unknown user';
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const text = parts.map((part) => part[0]?.toUpperCase()).join('');
  return text || '??';
}

function dateWindow(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const from = new Date(year ?? new Date().getFullYear(), (month ?? 1) - 1, day ?? 1);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function localDateTimeToIso(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(
    year ?? new Date().getFullYear(),
    (month ?? 1) - 1,
    day ?? 1,
    hours ?? 0,
    minutes ?? 0,
  ).toISOString();
}

function parseAttendees(value?: string): Array<{ name?: string; email?: string }> {
  const text = optionalText(value);
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const angle = line.match(/^(.*)<([^>]+)>$/);
      if (angle) return { name: angle[1]?.trim(), email: angle[2]?.trim() };
      if (line.includes('@')) return { email: line };
      return { name: line };
    });
}

function optionalText(value?: string | null): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}

function formatLongDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function formatOptionalDate(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

function openUrl(item: { metadata?: Record<string, unknown> | null }): string | undefined {
  const value = item.metadata?.webLink;
  return typeof value === 'string' && /^https:\/\//i.test(value) ? value : undefined;
}

function confidenceColor(value: number | null): string {
  if (value == null) return 'default';
  if (value >= 0.8) return 'green';
  if (value >= 0.5) return 'blue';
  return 'orange';
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}
