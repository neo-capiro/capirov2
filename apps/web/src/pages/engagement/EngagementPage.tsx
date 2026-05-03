import { useMemo, useState, type ReactNode } from 'react';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  MailOutlined,
  PlusOutlined,
  RobotOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useApi } from '../../lib/use-api.js';
import type { Client } from '../clients/clientTypes.js';

interface EngagementCapabilities {
  ai: { activeProvider: 'openai' | 'anthropic' | null };
  notes: { encryptedNotesConfigured: boolean };
  attachments: { s3Configured: boolean; maxBytes: number };
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
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  associationScore: number | null;
  associationReason: string | null;
  client: Pick<Client, 'id' | 'name' | 'website' | 'primaryContactName' | 'primaryContactEmail'> | null;
  attendees: MeetingAttendee[];
  preps: MeetingPrep[];
  notes: Array<{ id: string; confidential: boolean; createdAt: string }>;
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
  snippet: string | null;
  lastMessageAt: string | null;
  status: string;
  client: Pick<Client, 'id' | 'name'> | null;
  messages: Array<{ id: string; fromEmail: string | null; receivedAt: string | null }>;
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
  const [clientId, setClientId] = useState<string>('all');
  const [date, setDate] = useState(todayInputValue());
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [noteMeeting, setNoteMeeting] = useState<Meeting | null>(null);
  const [meetingForm] = Form.useForm<MeetingFormValues>();
  const [taskForm] = Form.useForm<TaskFormValues>();
  const [noteForm] = Form.useForm<{ body: string }>();

  const selectedClientId = clientId === 'all' ? undefined : clientId;
  const window = useMemo(() => dateWindow(date), [date]);

  const clients = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Client[]>('/api/clients')).data,
  });

  const capabilities = useQuery<EngagementCapabilities>({
    queryKey: ['engagement-capabilities'],
    queryFn: async () => (await api.get<EngagementCapabilities>('/api/engagement/capabilities')).data,
  });

  const meetings = useQuery<Meeting[]>({
    queryKey: ['engagement-meetings', selectedClientId, window.from, window.to],
    queryFn: async () =>
      (
        await api.get<Meeting[]>('/api/engagement/meetings', {
          params: { clientId: selectedClientId, from: window.from, to: window.to },
        })
      ).data,
  });

  const tasks = useQuery<EngagementTask[]>({
    queryKey: ['engagement-tasks', selectedClientId],
    queryFn: async () =>
      (
        await api.get<EngagementTask[]>('/api/engagement/tasks', {
          params: { clientId: selectedClientId },
        })
      ).data,
  });

  const mailThreads = useQuery<MailThread[]>({
    queryKey: ['engagement-mail-threads', selectedClientId],
    queryFn: async () =>
      (
        await api.get<MailThread[]>('/api/engagement/mail-threads', {
          params: { clientId: selectedClientId },
        })
      ).data,
  });

  const createMeeting = useMutation({
    mutationFn: async (values: MeetingFormValues) =>
      (
        await api.post('/api/engagement/meetings', {
          clientId: values.clientId || selectedClientId,
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
          clientId: selectedClientId,
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
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const createNote = useMutation({
    mutationFn: async ({ meetingId, body }: { meetingId: string; body: string }) =>
      (await api.post(`/api/engagement/meetings/${meetingId}/notes`, { body })).data,
    onSuccess: () => {
      message.success('Encrypted note saved');
      setNoteMeeting(null);
      noteForm.resetFields();
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
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
          <Select
            value={clientId}
            onChange={setClientId}
            className="engagement-client-select"
            options={[
              { value: 'all', label: 'All clients' },
              ...(clients.data ?? [])
                .filter((client) => client.status !== 'archived')
                .map((client) => ({ value: client.id, label: client.name })),
            ]}
          />
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
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
                clientId: selectedClientId,
              });
              setMeetingModalOpen(true);
            }}
          >
            Meeting
          </Button>
        </Space>
      </div>

      <div className="engagement-status-row">
        <StatusPill
          icon={<CalendarOutlined />}
          label={`${meetings.data?.length ?? 0} meetings`}
          tone="blue"
        />
        <StatusPill
          icon={<MailOutlined />}
          label={`${mailThreads.data?.length ?? 0} open threads`}
          tone="slate"
        />
        <StatusPill
          icon={<CheckCircleOutlined />}
          label={`${tasks.data?.filter((task) => task.status !== 'done').length ?? 0} follow-ups`}
          tone="green"
        />
        <StatusPill
          icon={<RobotOutlined />}
          label={capabilities.data?.ai.activeProvider ?? 'AI not configured'}
          tone={capabilities.data?.ai.activeProvider ? 'green' : 'muted'}
        />
      </div>

      <Tabs
        className="engagement-tabs"
        defaultActiveKey="meetings"
        items={[
          {
            key: 'meetings',
            label: 'Meetings',
            children: (
              <div className="engagement-work-grid">
                <div className="engagement-panel">
                  <PanelTitle icon={<CalendarOutlined />} title="Meetings" />
                  {meetings.data?.length ? (
                    <div className="engagement-meeting-list">
                      {meetings.data.map((meeting) => (
                        <MeetingCard
                          key={meeting.id}
                          meeting={meeting}
                          aiConfigured={Boolean(capabilities.data?.ai.activeProvider)}
                          notesConfigured={Boolean(capabilities.data?.notes.encryptedNotesConfigured)}
                          generating={generatePrep.isPending}
                          onGeneratePrep={() => generatePrep.mutate(meeting.id)}
                          onAddNote={() => setNoteMeeting(meeting)}
                        />
                      ))}
                    </div>
                  ) : (
                    <Empty description="No meetings for this date." />
                  )}
                </div>
                <TaskPanel
                  tasks={tasks.data ?? []}
                  updating={updateTaskStatus.isPending}
                  onDone={(task) => updateTaskStatus.mutate({ id: task.id, status: 'done' })}
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
            key: 'outreach',
            label: 'Outreach',
            children: <OutreachView threads={mailThreads.data ?? []} />,
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
        <Form form={meetingForm} layout="vertical" onFinish={(values) => createMeeting.mutate(values)}>
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
        title={noteMeeting ? `Encrypted note · ${noteMeeting.subject}` : 'Encrypted note'}
        open={Boolean(noteMeeting)}
        onCancel={() => setNoteMeeting(null)}
        onOk={() => noteForm.submit()}
        confirmLoading={createNote.isPending}
        okButtonProps={{ disabled: !capabilities.data?.notes.encryptedNotesConfigured }}
      >
        <Form
          form={noteForm}
          layout="vertical"
          onFinish={(values) => {
            if (noteMeeting) createNote.mutate({ meetingId: noteMeeting.id, body: values.body });
          }}
        >
          <Form.Item name="body" label="Note" rules={[{ required: true, min: 1 }]}>
            <Input.TextArea
              rows={5}
              disabled={!capabilities.data?.notes.encryptedNotesConfigured}
            />
          </Form.Item>
          {!capabilities.data?.notes.encryptedNotesConfigured ? (
            <Typography.Text type="secondary">
              Encrypted notes require NOTES_ENCRYPTION_KEY on the API.
            </Typography.Text>
          ) : null}
        </Form>
      </Modal>
    </section>
  );
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
            </div>
          ))}
        </div>
      ) : (
        <Empty description="No calendar items for this date." />
      )}
    </div>
  );
}

function OutreachView({ threads }: { threads: MailThread[] }) {
  return (
    <div className="engagement-panel">
      <PanelTitle icon={<MailOutlined />} title="Outreach" />
      {threads.length ? (
        <div className="engagement-thread-list">
          {threads.map((thread) => (
            <div className="engagement-thread-row" key={thread.id}>
              <Typography.Text strong>{thread.subject}</Typography.Text>
              <Typography.Text type="secondary">
                {[thread.client?.name, formatOptionalDate(thread.lastMessageAt), thread.status]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography.Text>
              {thread.snippet ? <Typography.Paragraph>{thread.snippet}</Typography.Paragraph> : null}
            </div>
          ))}
        </div>
      ) : (
        <Empty description="No synced email threads yet." />
      )}
    </div>
  );
}

function StatusPill({
  icon,
  label,
  tone,
}: {
  icon: ReactNode;
  label: string;
  tone: 'blue' | 'slate' | 'green' | 'muted';
}) {
  return (
    <div className={`engagement-status-pill engagement-status-pill--${tone}`}>
      {icon}
      <span>{label}</span>
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
