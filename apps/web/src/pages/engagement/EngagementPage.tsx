import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  EditOutlined,
  ExportOutlined,
  FileTextOutlined,
  LockOutlined,
  MailOutlined,
  PlusOutlined,
  RobotOutlined,
  SaveOutlined,
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
  status: 'generated' | 'edited' | 'approved' | 'stale' | 'failed';
  agenda: string[];
  talkingPoints: string[];
  risks: string[];
  followUps: string[];
  summary: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
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
  debriefs: MeetingDebriefSummary[];
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

interface MeetingDebriefSummary {
  id: string;
  confidential: boolean;
  accessLevel?: string;
  authorUserId?: string | null;
  author?: NoteAuthor | null;
  createdAt: string;
}

interface MeetingDebrief extends MeetingDebriefSummary {
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

interface PrepFormValues {
  summary?: string;
  agendaText?: string;
  talkingPointsText?: string;
  risksText?: string;
  followUpsText?: string;
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
  const [editingPrep, setEditingPrep] = useState<{ meeting: Meeting; prep: MeetingPrep } | null>(
    null,
  );
  const [meetingForm] = Form.useForm<MeetingFormValues>();
  const [taskForm] = Form.useForm<TaskFormValues>();
  const [noteForm] = Form.useForm<{ body: string }>();
  const [debriefForm] = Form.useForm<{ body: string }>();
  const [prepForm] = Form.useForm<PrepFormValues>();

  const window = useMemo(() => dateWindow(date), [date]);
  const calendarWindow = useMemo(() => workWeekWindow(date), [date]);

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

  const calendarMeetings = useQuery<Meeting[]>({
    queryKey: [
      'engagement-calendar-meetings',
      selectedClientId,
      calendarWindow.from,
      calendarWindow.to,
    ],
    queryFn: async () =>
      (
        await api.get<Meeting[]>('/api/engagement/meetings', {
          params: {
            clientId: selectedClientId ?? undefined,
            from: calendarWindow.from,
            to: calendarWindow.to,
          },
        })
      ).data,
    enabled: meetingViewMode === 'calendar',
  });

  const visibleMeetings = useMemo(
    () => (meetingViewMode === 'calendar' ? (calendarMeetings.data ?? []) : (meetings.data ?? [])),
    [calendarMeetings.data, meetingViewMode, meetings.data],
  );
  const selectedMeeting = useMemo(
    () => visibleMeetings.find((meeting) => meeting.id === selectedMeetingId) ?? null,
    [visibleMeetings, selectedMeetingId],
  );
  const contextClientId = selectedClientId ?? selectedMeeting?.client?.id ?? null;

  useEffect(() => {
    const rows = visibleMeetings;
    if (!rows.length) {
      setSelectedMeetingId(null);
      return;
    }
    if (!selectedMeetingId || !rows.some((meeting) => meeting.id === selectedMeetingId)) {
      setSelectedMeetingId(rows[0]?.id ?? null);
    }
  }, [selectedMeetingId, visibleMeetings]);

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

  const meetingDebriefs = useQuery<MeetingDebrief[]>({
    queryKey: ['engagement-meeting-debriefs', selectedMeeting?.id],
    queryFn: async () =>
      (await api.get<MeetingDebrief[]>(`/api/engagement/meetings/${selectedMeeting?.id}/debriefs`))
        .data,
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
      qc.invalidateQueries({ queryKey: ['engagement-calendar-meetings'] });
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
      qc.invalidateQueries({ queryKey: ['engagement-calendar-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-client-context'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const updatePrep = useMutation({
    mutationFn: async ({ prepId, values }: { prepId: string; values: PrepFormValues }) =>
      (
        await api.patch(`/api/engagement/meeting-preps/${prepId}`, {
          summary: optionalText(values.summary) ?? null,
          agenda: linesToArray(values.agendaText),
          talkingPoints: linesToArray(values.talkingPointsText),
          risks: linesToArray(values.risksText),
          followUps: linesToArray(values.followUpsText),
        })
      ).data,
    onSuccess: () => {
      message.success('Meeting prep saved');
      setEditingPrep(null);
      prepForm.resetFields();
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-calendar-meetings'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const approvePrep = useMutation({
    mutationFn: async (prepId: string) =>
      (await api.post(`/api/engagement/meeting-preps/${prepId}/approve`)).data,
    onSuccess: () => {
      message.success('Meeting prep approved');
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-calendar-meetings'] });
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
      qc.invalidateQueries({ queryKey: ['engagement-calendar-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-meeting-notes'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const createDebrief = useMutation({
    mutationFn: async ({ meetingId, body }: { meetingId: string; body: string }) =>
      (
        await api.post(`/api/engagement/meetings/${meetingId}/debriefs`, {
          body,
          confidential: true,
          accessLevel: 'tenant_members',
        })
      ).data,
    onSuccess: () => {
      message.success('Debrief saved');
      debriefForm.resetFields();
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-calendar-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-meeting-debriefs'] });
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

                  {(
                    meetingViewMode === 'calendar' ? calendarMeetings.isLoading : meetings.isLoading
                  ) ? (
                    <Empty description="Loading Outlook meetings..." />
                  ) : visibleMeetings.length ? (
                    meetingViewMode === 'list' ? (
                      <div className="engagement-agenda-list">
                        {visibleMeetings.map((meeting) => (
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
                        meetings={visibleMeetings}
                        selectedId={selectedMeeting?.id ?? null}
                        weekStart={calendarWindow.weekStart}
                        weekEnd={calendarWindow.weekEnd}
                        onSelect={(meetingId) => {
                          setSelectedMeetingId(meetingId);
                          const meeting = visibleMeetings.find((item) => item.id === meetingId);
                          setMeetingDetailTab(meeting?.preps[0] ? 'prep' : 'intel');
                        }}
                        onPreviousWeek={() => setDate(shiftDate(date, -7))}
                        onNextWeek={() => setDate(shiftDate(date, 7))}
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
                  debriefs={meetingDebriefs.data ?? []}
                  debriefsLoading={meetingDebriefs.isLoading}
                  activeTab={meetingDetailTab}
                  onTabChange={setMeetingDetailTab}
                  noteForm={noteForm}
                  debriefForm={debriefForm}
                  notesConfigured={Boolean(capabilities.data?.notes.encryptedNotesConfigured)}
                  aiConfigured={Boolean(capabilities.data?.ai.activeProvider)}
                  generating={generatePrep.isPending}
                  savingNote={createNote.isPending}
                  savingDebrief={createDebrief.isPending}
                  approving={approvePrep.isPending}
                  onGeneratePrep={(meeting) => generatePrep.mutate(meeting.id)}
                  onCreateNote={(meeting, body) =>
                    createNote.mutate({ meetingId: meeting.id, body })
                  }
                  onCreateDebrief={(meeting, body) =>
                    createDebrief.mutate({ meetingId: meeting.id, body })
                  }
                  onEditPrep={(meeting, prep) => {
                    prepForm.setFieldsValue({
                      summary: prep.summary ?? '',
                      agendaText: prep.agenda.join('\n'),
                      talkingPointsText: prep.talkingPoints.join('\n'),
                      risksText: prep.risks.join('\n'),
                      followUpsText: prep.followUps.join('\n'),
                    });
                    setEditingPrep({ meeting, prep });
                  }}
                  onApprovePrep={(prep) => approvePrep.mutate(prep.id)}
                  onExportPdf={(meeting) =>
                    exportMeetingPdf({
                      meeting,
                      notes: meetingNotes.data ?? [],
                      debriefs: meetingDebriefs.data ?? [],
                      context: clientContext.data,
                    })
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

      <Modal
        title={editingPrep ? `Edit prep - ${editingPrep.meeting.subject}` : 'Edit prep'}
        open={Boolean(editingPrep)}
        onCancel={() => setEditingPrep(null)}
        onOk={() => prepForm.submit()}
        confirmLoading={updatePrep.isPending}
        width={760}
      >
        <Form
          form={prepForm}
          layout="vertical"
          onFinish={(values) => {
            if (editingPrep) updatePrep.mutate({ prepId: editingPrep.prep.id, values });
          }}
        >
          <Form.Item name="summary" label="Context summary">
            <Input.TextArea rows={3} maxLength={2000} showCount />
          </Form.Item>
          <Form.Item name="agendaText" label="Agenda">
            <Input.TextArea rows={5} placeholder="One agenda item per line" />
          </Form.Item>
          <Form.Item name="talkingPointsText" label="Talking points">
            <Input.TextArea rows={5} placeholder="One talking point per line" />
          </Form.Item>
          <Form.Item name="risksText" label="Risks">
            <Input.TextArea rows={3} placeholder="One risk per line" />
          </Form.Item>
          <Form.Item name="followUpsText" label="Follow-ups">
            <Input.TextArea rows={3} placeholder="One follow-up per line" />
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
  weekStart,
  weekEnd,
  onSelect,
  onPreviousWeek,
  onNextWeek,
}: {
  meetings: Meeting[];
  selectedId: string | null;
  weekStart: Date;
  weekEnd: Date;
  onSelect: (id: string) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
}) {
  const days = workWeekDays(weekStart);
  const grouped = groupMeetingsByDate(meetings);
  const counts = meetingStatusCounts(meetings);

  return (
    <div className="engagement-week-calendar">
      <div className="engagement-week-toolbar">
        <Typography.Text strong>{formatCalendarRange(weekStart, weekEnd)}</Typography.Text>
        <Space size={8}>
          <Button size="small" onClick={onPreviousWeek}>
            {'<'}
          </Button>
          <Button size="small" onClick={onNextWeek}>
            {'>'}
          </Button>
        </Space>
      </div>
      <div className="engagement-week-grid">
        {days.map((day) => {
          const key = localDateKey(day);
          const dayMeetings = grouped.get(key) ?? [];
          return (
            <section className="engagement-week-day" key={key}>
              <div className="engagement-week-day-head">
                <Typography.Text>{weekdayShort(day)}</Typography.Text>
                <span className={localDateKey(new Date()) === key ? 'today' : ''}>
                  {day.getDate()}
                </span>
              </div>
              <div className="engagement-week-items">
                {dayMeetings.length ? (
                  dayMeetings.map((meeting) => {
                    const status = meetingStatus(meeting);
                    return (
                      <button
                        key={meeting.id}
                        type="button"
                        className={`engagement-week-event engagement-week-event--${status.kind}${
                          meeting.id === selectedId ? ' selected' : ''
                        }`}
                        onClick={() => onSelect(meeting.id)}
                      >
                        <span>{formatTime(meeting.startsAt)}</span>
                        <strong>{meeting.subject}</strong>
                        <small>
                          {meeting.client?.name ?? meeting.location ?? sourceLabel(meeting.source)}
                        </small>
                        {status.label ? <em>{status.label}</em> : null}
                      </button>
                    );
                  })
                ) : (
                  <Typography.Text type="secondary">No meetings</Typography.Text>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <div className="engagement-week-legend">
        <span>
          <i className="missing" /> {counts.debriefMissing} debrief missing
        </span>
        <span>
          <i className="needs-prep" /> {counts.needsPrep} need prep
        </span>
        <span>
          <i className="prepped" /> {counts.prepped} prepped
        </span>
      </div>
    </div>
  );
}

function MeetingDetailPanel({
  meeting,
  context,
  contextLoading,
  notes,
  notesLoading,
  debriefs,
  debriefsLoading,
  activeTab,
  onTabChange,
  noteForm,
  debriefForm,
  notesConfigured,
  aiConfigured,
  generating,
  savingNote,
  savingDebrief,
  approving,
  onGeneratePrep,
  onCreateNote,
  onCreateDebrief,
  onEditPrep,
  onApprovePrep,
  onExportPdf,
}: {
  meeting: Meeting | null;
  context?: ClientContext;
  contextLoading: boolean;
  notes: MeetingNote[];
  notesLoading: boolean;
  debriefs: MeetingDebrief[];
  debriefsLoading: boolean;
  activeTab: string;
  onTabChange: (key: string) => void;
  noteForm: ReturnType<typeof Form.useForm<{ body: string }>>[0];
  debriefForm: ReturnType<typeof Form.useForm<{ body: string }>>[0];
  notesConfigured: boolean;
  aiConfigured: boolean;
  generating: boolean;
  savingNote: boolean;
  savingDebrief: boolean;
  approving: boolean;
  onGeneratePrep: (meeting: Meeting) => void;
  onCreateNote: (meeting: Meeting, body: string) => void;
  onCreateDebrief: (meeting: Meeting, body: string) => void;
  onEditPrep: (meeting: Meeting, prep: MeetingPrep) => void;
  onApprovePrep: (prep: MeetingPrep) => void;
  onExportPdf: (meeting: Meeting) => void;
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

      <div className="engagement-detail-scroll">
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
              children: (
                <div className="engagement-detail-stack">
                  <Form
                    form={debriefForm}
                    layout="vertical"
                    onFinish={(values) => onCreateDebrief(meeting, values.body)}
                  >
                    <Form.Item
                      name="body"
                      label="Meeting debrief"
                      rules={[{ required: true, min: 1 }]}
                    >
                      <Input.TextArea
                        rows={7}
                        placeholder="Capture outcomes, decisions, commitments, and next steps..."
                        disabled={!notesConfigured}
                      />
                    </Form.Item>
                    <Button
                      type="primary"
                      htmlType="submit"
                      icon={<SaveOutlined />}
                      loading={savingDebrief}
                      disabled={!notesConfigured}
                    >
                      Save debrief
                    </Button>
                  </Form>

                  <div className="engagement-note-history">
                    <Typography.Text strong>Previous debriefs</Typography.Text>
                    {debriefsLoading ? (
                      <Typography.Text type="secondary">Loading debriefs...</Typography.Text>
                    ) : debriefs.length ? (
                      debriefs.map((debrief) => (
                        <article className="engagement-note-entry" key={debrief.id}>
                          <div>
                            <Typography.Text strong>{noteAuthor(debrief)}</Typography.Text>
                            <Typography.Text type="secondary">
                              {formatDateTime(debrief.createdAt)}
                            </Typography.Text>
                          </div>
                          <Typography.Paragraph>
                            {debrief.restricted
                              ? 'This confidential debrief is restricted to its author and tenant admins.'
                              : debrief.body}
                          </Typography.Paragraph>
                        </article>
                      ))
                    ) : (
                      <Typography.Text type="secondary">No debriefs captured yet.</Typography.Text>
                    )}
                  </div>
                </div>
              ),
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
      </div>
      <div className="engagement-detail-actions">
        <Button
          icon={<EditOutlined />}
          disabled={!prep}
          onClick={() => {
            if (prep) onEditPrep(meeting, prep);
          }}
        >
          Edit
        </Button>
        <Button icon={<DownloadOutlined />} onClick={() => onExportPdf(meeting)}>
          Export PDF
        </Button>
        <Button
          type="primary"
          disabled={!prep || prep.status === 'approved'}
          loading={approving}
          onClick={() => {
            if (prep) onApprovePrep(prep);
          }}
        >
          {prep?.status === 'approved' ? 'Approved' : 'Approve'}
        </Button>
      </div>
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

function linesToArray(value?: string): string[] {
  return (value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 80);
}

function formatMeetingDay(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

function formatCalendarRange(start: Date, end: Date): string {
  const sameMonth =
    start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startText = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(start);
  const endText = new Intl.DateTimeFormat(undefined, {
    ...(sameMonth ? {} : { month: 'short' as const }),
    day: 'numeric',
    year: 'numeric',
  }).format(end);
  return `${startText} - ${endText}`;
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

function noteAuthor(
  note: MeetingNote | MeetingNoteSummary | MeetingDebrief | MeetingDebriefSummary,
): string {
  const author = note.author;
  const name = [author?.firstName, author?.lastName].filter(Boolean).join(' ').trim();
  return name || author?.email || 'Unknown user';
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const text = parts.map((part) => part[0]?.toUpperCase()).join('');
  return text || '??';
}

function workWeekWindow(date: string) {
  const selected = localDateFromInput(date);
  const weekday = selected.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const weekStart = addLocalDays(selected, mondayOffset);
  const weekEnd = addLocalDays(weekStart, 4);
  const toExclusive = addLocalDays(weekStart, 5);
  return {
    from: weekStart.toISOString(),
    to: toExclusive.toISOString(),
    weekStart,
    weekEnd,
  };
}

function workWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 5 }, (_, index) => addLocalDays(weekStart, index));
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function shiftDate(date: string, days: number): string {
  const next = addLocalDays(localDateFromInput(date), days);
  return inputValueFromDate(next);
}

function localDateFromInput(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year ?? new Date().getFullYear(), (month ?? 1) - 1, day ?? 1);
}

function inputValueFromDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function localDateKey(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return inputValueFromDate(date);
}

function weekdayShort(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
}

function groupMeetingsByDate(meetings: Meeting[]): Map<string, Meeting[]> {
  const grouped = new Map<string, Meeting[]>();
  for (const meeting of meetings) {
    const key = localDateKey(meeting.startsAt);
    const rows = grouped.get(key) ?? [];
    rows.push(meeting);
    grouped.set(key, rows);
  }
  for (const rows of grouped.values()) {
    rows.sort(
      (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
    );
  }
  return grouped;
}

function meetingStatus(meeting: Meeting): {
  kind: 'missing' | 'needs-prep' | 'prepped';
  label: string;
} {
  const hasDebrief = meeting.debriefs.length > 0;
  const hasEnded = new Date(meeting.endsAt).getTime() < Date.now();
  if (hasEnded && !hasDebrief) return { kind: 'missing', label: 'Debrief missing' };
  const prep = meeting.preps[0];
  if (!prep) return { kind: 'needs-prep', label: 'Needs prep' };
  return { kind: 'prepped', label: prep.status === 'approved' ? 'Approved' : 'Prepped' };
}

function meetingStatusCounts(meetings: Meeting[]) {
  return meetings.reduce(
    (counts, meeting) => {
      const status = meetingStatus(meeting).kind;
      if (status === 'missing') counts.debriefMissing += 1;
      if (status === 'needs-prep') counts.needsPrep += 1;
      if (status === 'prepped') counts.prepped += 1;
      return counts;
    },
    { debriefMissing: 0, needsPrep: 0, prepped: 0 },
  );
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

function exportMeetingPdf({
  meeting,
  notes,
  debriefs,
  context,
}: {
  meeting: Meeting;
  notes: MeetingNote[];
  debriefs: MeetingDebrief[];
  context?: ClientContext;
}) {
  const prep = meeting.preps[0];
  const lines = [
    'Capiro Meeting Prep',
    '',
    meeting.subject,
    `${formatLongDate(meeting.startsAt)} | ${formatTimeRange(meeting.startsAt, meeting.endsAt)}`,
    `Client: ${meeting.client?.name ?? 'Unlinked'}`,
    `Location: ${meeting.location || 'No location'}`,
    '',
    'Context',
    prep?.summary || contextSummary(context, false),
    '',
    'Agenda',
    ...(prep?.agenda.length ? prep.agenda.map((item) => `- ${item}`) : ['No agenda saved.']),
    '',
    'Talking Points',
    ...(prep?.talkingPoints.length
      ? prep.talkingPoints.map((item) => `- ${item}`)
      : ['No talking points saved.']),
    '',
    'Participants',
    ...meetingParticipants(meeting).map(
      (participant) =>
        `- ${participant.name}${participant.role ? `, ${participant.role}` : ''}${
          participant.email ? ` (${participant.email})` : ''
        }`,
    ),
    '',
    'Visible Notes',
    ...(notes.filter((note) => !note.restricted && note.body).length
      ? notes
          .filter((note) => !note.restricted && note.body)
          .flatMap((note) => [
            `${formatDateTime(note.createdAt)} by ${noteAuthor(note)}`,
            note.body ?? '',
          ])
      : ['No visible notes saved.']),
    '',
    'Debriefs',
    ...(debriefs.filter((debrief) => !debrief.restricted && debrief.body).length
      ? debriefs
          .filter((debrief) => !debrief.restricted && debrief.body)
          .flatMap((debrief) => [
            `${formatDateTime(debrief.createdAt)} by ${noteAuthor(debrief)}`,
            debrief.body ?? '',
          ])
      : ['No debriefs saved.']),
  ];

  const pdf = buildSimplePdf(lines.flatMap((line) => wrapPdfLine(line)));
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(meeting.subject)}-prep.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function wrapPdfLine(line: string, max = 88): string[] {
  if (line.length <= max) return [line];
  const words = line.split(/\s+/);
  const rows: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      rows.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) rows.push(current);
  return rows;
}

function buildSimplePdf(lines: string[]): string {
  const linesPerPage = 48;
  const pages = chunk(lines, linesPerPage);
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageObjectIds: number[] = [];
  for (const [pageIndex, pageLines] of pages.entries()) {
    const pageObjectId = objects.length + 1;
    const contentObjectId = objects.length + 2;
    pageObjectIds.push(pageObjectId);
    const content = [
      'BT',
      '/F1 11 Tf',
      '54 738 Td',
      '14 TL',
      ...pageLines.map((line, index) =>
        index === 0 ? `(${escapePdfText(line)}) Tj` : `T* (${escapePdfText(line)}) Tj`,
      ),
      `T* (Page ${pageIndex + 1} of ${pages.length}) Tj`,
      'ET',
    ].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }

  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds
    .map((id) => `${id} 0 R`)
    .join(' ')}] /Count ${pageObjectIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function escapePdfText(value: string): string {
  return value
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function chunk<T>(values: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    rows.push(values.slice(index, index + size));
  }
  return rows.length ? rows : [[]];
}

function safeFileName(value: string): string {
  return (
    value
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'meeting'
  );
}
