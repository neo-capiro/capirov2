import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  EditOutlined,
  ExportOutlined,
  FileTextOutlined,
  MailOutlined,
  PlusOutlined,
  RobotOutlined,
  SaveOutlined,
  UploadOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Empty, Form, Input, Modal, Select, Space, Tabs, Tag, Typography } from 'antd';
import { useMe } from '../../lib/me.js';
import { useApi } from '../../lib/use-api.js';
import { useClientFilter } from '../../state/client-filter.js';
import type { Client } from '../clients/clientTypes.js';
import { OutreachView } from './OutreachView.js';

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
  attachments: EngagementAttachment[];
  preps: MeetingPrep[];
  notes: MeetingNoteSummary[];
  debriefs: MeetingDebriefSummary[];
}

interface EngagementAttachment {
  id: string;
  meetingId: string | null;
  fileName: string;
  contentType: string;
  byteSize: number | null;
  source: string;
  createdAt: string;
  downloadUrl?: string | null;
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

interface MeetingDebriefDraft {
  recap: string;
  actionItems: string[];
  notes: string;
  provider: 'openai' | 'anthropic';
  model: string;
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

type ReportPeriod = 'current' | 'previous' | 'all';
type ReportStatus = 'not_started' | 'in_progress' | 'complete';
type ReportStatusField = 'prepStatus' | 'outreachStatus' | 'submissionStatus';

interface EngagementReportMeeting {
  id: string;
  subject: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  externalUrl: string | null;
}

interface EngagementReportRow {
  targetId: string | null;
  clientId: string | null;
  clientName: string | null;
  scopeKey: string;
  officeKey: string;
  memberPrincipal: string;
  committee: string | null;
  staffer: string | null;
  building: string | null;
  leadOwner: string | null;
  meetingsHeld: number;
  outreachSent: number;
  pendingActions: number;
  prepStatus: ReportStatus;
  outreachStatus: ReportStatus;
  submissionStatus: ReportStatus;
  source: string;
  manuallyOverridden: boolean;
  meetings: EngagementReportMeeting[];
}

interface EngagementReport {
  cycle: {
    period: ReportPeriod;
    label: string;
    from: string | null;
    to: string | null;
  };
  summary: {
    targetOffices: number;
    meetingsHeld: number;
    outreachSent: number;
    submissionsFiled: number;
    pendingActions: number;
  };
  rows: EngagementReportRow[];
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

interface DebriefDraftState {
  recap: string;
  actionItems: string[];
  notes: string;
}

interface TargetOfficeFormValues {
  clientId?: string;
  memberPrincipal: string;
  committee?: string;
  staffer?: string;
  building?: string;
  leadOwner?: string;
}

export function EngagementPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const me = useMe();
  const { selectedClientId, setSelectedClientId } = useClientFilter();
  const defaultRange = useMemo(() => defaultMeetingRange(), []);
  const [rangeStart, setRangeStart] = useState(defaultRange.start);
  const [rangeEnd, setRangeEnd] = useState(defaultRange.end);
  const [calendarDate, setCalendarDate] = useState(todayInputValue());
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [meetingDetailTab, setMeetingDetailTab] = useState('prep');
  const [activeEngagementTab, setActiveEngagementTab] = useState('meetings');
  const [meetingViewMode, setMeetingViewMode] = useState<'list' | 'calendar'>('list');
  const [historyBatch, setHistoryBatch] = useState(0);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('current');
  const [reportStatusFilter, setReportStatusFilter] = useState<'all' | ReportStatus>('all');
  const [reportSort, setReportSort] = useState('member-asc');
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [targetOfficeModalOpen, setTargetOfficeModalOpen] = useState(false);
  const [reportMeetingRow, setReportMeetingRow] = useState<EngagementReportRow | null>(null);
  const [editingPrep, setEditingPrep] = useState<{ meeting: Meeting; prep: MeetingPrep } | null>(
    null,
  );
  const [meetingForm] = Form.useForm<MeetingFormValues>();
  const [taskForm] = Form.useForm<TaskFormValues>();
  const [debriefForm] = Form.useForm<{ body: string }>();
  const [prepForm] = Form.useForm<PrepFormValues>();
  const [targetOfficeForm] = Form.useForm<TargetOfficeFormValues>();

  const meetingWindow = useMemo(
    () => dateRangeWindow(rangeStart, rangeEnd, historyBatch),
    [historyBatch, rangeEnd, rangeStart],
  );
  const calendarWindow = useMemo(() => workWeekWindow(calendarDate), [calendarDate]);

  const clients = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Client[]>('/api/clients')).data,
  });
  const activeClients = useMemo(
    () =>
      (clients.data ?? [])
        .filter((client) => client.status !== 'archived')
        .sort((left, right) => left.name.localeCompare(right.name)),
    [clients.data],
  );

  const capabilities = useQuery<EngagementCapabilities>({
    queryKey: ['engagement-capabilities'],
    queryFn: async () =>
      (await api.get<EngagementCapabilities>('/api/engagement/capabilities')).data,
  });

  const meetings = useQuery<Meeting[]>({
    queryKey: ['engagement-meetings', selectedClientId, meetingWindow.from, meetingWindow.to],
    queryFn: async () =>
      (
        await api.get<Meeting[]>('/api/engagement/meetings', {
          params: {
            clientId: selectedClientId ?? undefined,
            from: meetingWindow.from,
            to: meetingWindow.to,
          },
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
    () =>
      meetingViewMode === 'calendar'
        ? (calendarMeetings.data ?? [])
        : [...(meetings.data ?? [])].sort(
            (left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime(),
          ),
    [calendarMeetings.data, meetingViewMode, meetings.data],
  );
  const selectedMeetingFromVisible = useMemo(
    () => visibleMeetings.find((meeting) => meeting.id === selectedMeetingId) ?? null,
    [visibleMeetings, selectedMeetingId],
  );
  const selectedMeetingQuery = useQuery<Meeting>({
    queryKey: ['engagement-meeting', selectedMeetingId],
    queryFn: async () =>
      (await api.get<Meeting>(`/api/engagement/meetings/${selectedMeetingId}`)).data,
    enabled: Boolean(selectedMeetingId && !selectedMeetingFromVisible),
  });
  const selectedMeeting = selectedMeetingFromVisible ?? selectedMeetingQuery.data ?? null;
  const contextClientId = selectedClientId ?? selectedMeeting?.client?.id ?? null;

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

  const meetingAttachments = useQuery<EngagementAttachment[]>({
    queryKey: ['engagement-meeting-attachments', selectedMeeting?.id],
    queryFn: async () =>
      (
        await api.get<EngagementAttachment[]>('/api/engagement/attachments', {
          params: { meetingId: selectedMeeting?.id },
        })
      ).data,
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

  const report = useQuery<EngagementReport>({
    queryKey: ['engagement-report', selectedClientId, reportPeriod],
    queryFn: async () =>
      (
        await api.get<EngagementReport>('/api/engagement/reports/overview', {
          params: { clientId: selectedClientId ?? undefined, period: reportPeriod },
        })
      ).data,
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

  const createTargetOffice = useMutation({
    mutationFn: async (values: TargetOfficeFormValues) =>
      (
        await api.post('/api/engagement/reports/target-offices', {
          clientId: values.clientId || selectedClientId || undefined,
          memberPrincipal: values.memberPrincipal,
          committee: optionalText(values.committee),
          staffer: optionalText(values.staffer),
          building: optionalText(values.building),
          leadOwner: optionalText(values.leadOwner),
        })
      ).data,
    onSuccess: () => {
      message.success('Target office added');
      setTargetOfficeModalOpen(false);
      targetOfficeForm.resetFields();
      qc.invalidateQueries({ queryKey: ['engagement-report'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const updateReportTarget = useMutation({
    mutationFn: async ({
      row,
      field,
      status,
    }: {
      row: EngagementReportRow;
      field: ReportStatusField;
      status: ReportStatus;
    }) =>
      (
        await api.post('/api/engagement/reports/target-offices/overrides', {
          clientId:
            row.scopeKey === 'all' ? undefined : (row.clientId ?? selectedClientId ?? undefined),
          officeKey: row.officeKey,
          memberPrincipal: row.memberPrincipal,
          committee: row.committee,
          staffer: row.staffer,
          building: row.building,
          leadOwner: row.leadOwner,
          [field]: status,
          source: row.source === 'manual' ? 'manual' : 'manual_override',
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engagement-report'] }),
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
    onSuccess: (_prep, meetingId) => {
      message.success('Meeting prep generated');
      qc.invalidateQueries({ queryKey: ['engagement-meeting', meetingId] });
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-calendar-meetings'] });
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
        await api.post<MeetingNote>(`/api/engagement/meetings/${meetingId}/notes`, {
          body,
          confidential: true,
          accessLevel: 'tenant_members',
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-calendar-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-meeting-notes'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const updateNote = useMutation({
    mutationFn: async ({
      meetingId,
      noteId,
      body,
    }: {
      meetingId: string;
      noteId: string;
      body: string;
    }) =>
      (
        await api.patch<MeetingNote>(`/api/engagement/meetings/${meetingId}/notes/${noteId}`, {
          body,
          confidential: true,
          accessLevel: 'tenant_members',
        })
      ).data,
    onSuccess: () => {
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

  const generateDebriefDraft = useMutation({
    mutationFn: async ({
      meetingId,
      method,
      sourceText,
    }: {
      meetingId: string;
      method: 'upload' | 'manual' | 'voice';
      sourceText: string;
    }) =>
      (
        await api.post<MeetingDebriefDraft>(`/api/engagement/meetings/${meetingId}/debrief-draft`, {
          method,
          sourceText,
        })
      ).data,
    onError: (err) => message.error(errorMessage(err)),
  });

  const uploadTranscript = useMutation({
    mutationFn: async ({ meeting, file }: { meeting: Meeting; file: File }) => {
      const contentType = file.type || 'application/octet-stream';
      const upload = (
        await api.post<{
          url: string;
          fields: Record<string, string>;
          s3Key: string;
        }>('/api/engagement/attachments/upload-url', {
          meetingId: meeting.id,
          clientId: meeting.client?.id ?? undefined,
          fileName: file.name,
          contentType,
          contentLength: file.size,
        })
      ).data;
      const form = new FormData();
      Object.entries(upload.fields).forEach(([key, value]) => form.append(key, value));
      form.append('file', file);
      const result = await fetch(upload.url, { method: 'POST', body: form });
      if (!result.ok) throw new Error('Transcript upload failed');
      return (
        await api.post<EngagementAttachment>('/api/engagement/attachments/confirm', {
          meetingId: meeting.id,
          clientId: meeting.client?.id ?? undefined,
          fileName: file.name,
          contentType,
          s3Key: upload.s3Key,
        })
      ).data;
    },
    onSuccess: () => {
      message.success('Transcript uploaded');
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-calendar-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-meeting-attachments'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const deleteAttachment = useMutation({
    mutationFn: async (attachmentId: string) =>
      (await api.delete(`/api/engagement/attachments/${attachmentId}`)).data,
    onSuccess: () => {
      message.success('Attachment removed');
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-calendar-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-meeting-attachments'] });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  useEffect(() => {
    const handler = () => setActiveEngagementTab('outreach');
    window.addEventListener('capiro:open-outreach', handler);
    return () => window.removeEventListener('capiro:open-outreach', handler);
  }, []);

  const generatingPrepMeetingId = generatePrep.isPending ? (generatePrep.variables ?? null) : null;
  const detailTab = meetingDetailTab === 'notes' ? 'prep' : meetingDetailTab;

  const openMeetingModal = () => {
    meetingForm.setFieldsValue({
      date: todayInputValue(),
      startsAt: '09:00',
      endsAt: '09:30',
      clientId: selectedClientId ?? undefined,
    });
    setMeetingModalOpen(true);
  };

  const handleGeneratePrep = (meeting: Meeting) => {
    setSelectedMeetingId(meeting.id);
    setMeetingDetailTab('prep');
    generatePrep.mutate(meeting.id);
  };

  return (
    <section className="engagement-page">
      <ClientSelectorBar
        clients={activeClients}
        selectedClientId={selectedClientId}
        onSelect={setSelectedClientId}
      />
      <Tabs
        className="engagement-tabs"
        activeKey={activeEngagementTab}
        onChange={setActiveEngagementTab}
        tabBarExtraContent={
          activeEngagementTab === 'meetings'
            ? {
                right: (
                  <Space size={10} className="engagement-tab-actions">
                    <Button icon={<PlusOutlined />} onClick={() => setTaskModalOpen(true)}>
                      Task
                    </Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openMeetingModal}>
                      Meeting
                    </Button>
                  </Space>
                ),
              }
            : undefined
        }
        items={[
          {
            key: 'meetings',
            label: 'Meetings',
            children: (
              <div className="engagement-meeting-shell">
                <div className="engagement-panel engagement-schedule-panel">
                  <div className="engagement-schedule-head">
                    <PanelTitle icon={<CalendarOutlined />} title="Meetings" />
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
                      <MeetingListView
                        meetings={visibleMeetings}
                        selectedId={selectedMeeting?.id ?? null}
                        rangeStart={rangeStart}
                        rangeEnd={rangeEnd}
                        defaultRange={defaultRange}
                        historyBatch={historyBatch}
                        generatingMeetingId={generatingPrepMeetingId}
                        aiConfigured={Boolean(capabilities.data?.ai.activeProvider)}
                        onRangeStart={setRangeStart}
                        onRangeEnd={setRangeEnd}
                        onClearRange={() => {
                          setHistoryBatch(0);
                          setRangeStart(defaultRange.start);
                          setRangeEnd(defaultRange.end);
                        }}
                        onSelect={(meeting, tab) => {
                          setSelectedMeetingId(meeting.id);
                          setMeetingDetailTab(tab ?? 'prep');
                        }}
                        onGeneratePrep={(meeting) => {
                          handleGeneratePrep(meeting);
                        }}
                        onLoadMore={() => setHistoryBatch((value) => value + 1)}
                      />
                    ) : (
                      <MeetingCalendarList
                        meetings={visibleMeetings}
                        selectedId={selectedMeeting?.id ?? null}
                        weekStart={calendarWindow.weekStart}
                        weekEnd={calendarWindow.weekEnd}
                        onSelect={(meetingId) => {
                          setSelectedMeetingId(meetingId);
                          setMeetingDetailTab('prep');
                        }}
                        onAction={(meetingId, tab) => {
                          setSelectedMeetingId(meetingId);
                          setMeetingDetailTab(tab);
                        }}
                        onPreviousWeek={() => setCalendarDate(shiftDate(calendarDate, -7))}
                        onNextWeek={() => setCalendarDate(shiftDate(calendarDate, 7))}
                      />
                    )
                  ) : (
                    <MeetingListEmpty
                      hasAnySyncedMeetings={Boolean((meetings.data ?? []).length)}
                      onSync={() => window.dispatchEvent(new Event('capiro:sync-inbox'))}
                    />
                  )}
                </div>

                <MeetingDetailPanel
                  meeting={selectedMeeting}
                  context={clientContext.data}
                  contextLoading={clientContext.isLoading}
                  notes={meetingNotes.data ?? []}
                  notesLoading={meetingNotes.isLoading}
                  attachments={meetingAttachments.data ?? selectedMeeting?.attachments ?? []}
                  attachmentsLoading={meetingAttachments.isLoading}
                  debriefs={meetingDebriefs.data ?? []}
                  debriefsLoading={meetingDebriefs.isLoading}
                  activeTab={detailTab}
                  onTabChange={setMeetingDetailTab}
                  debriefForm={debriefForm}
                  currentUserId={me.data?.user.id ?? null}
                  notesConfigured={Boolean(capabilities.data?.notes.encryptedNotesConfigured)}
                  attachmentsConfigured={Boolean(capabilities.data?.attachments.s3Configured)}
                  aiConfigured={Boolean(capabilities.data?.ai.activeProvider)}
                  generating={generatingPrepMeetingId === selectedMeeting?.id}
                  savingNote={createNote.isPending || updateNote.isPending}
                  uploadingTranscript={uploadTranscript.isPending}
                  deletingAttachmentId={
                    typeof deleteAttachment.variables === 'string'
                      ? deleteAttachment.variables
                      : null
                  }
                  savingDebrief={createDebrief.isPending}
                  generatingDebrief={generateDebriefDraft.isPending}
                  approving={approvePrep.isPending}
                  onGeneratePrep={handleGeneratePrep}
                  onSaveNote={(meeting, noteId, body) =>
                    noteId
                      ? updateNote.mutateAsync({ meetingId: meeting.id, noteId, body })
                      : createNote.mutateAsync({ meetingId: meeting.id, body })
                  }
                  onUploadTranscript={(meeting, file) => uploadTranscript.mutate({ meeting, file })}
                  onRemoveAttachment={(attachmentId) => deleteAttachment.mutate(attachmentId)}
                  onCreateDebrief={(meeting, body) =>
                    createDebrief.mutate({ meetingId: meeting.id, body })
                  }
                  onGenerateDebrief={(meeting, method, sourceText) =>
                    generateDebriefDraft.mutateAsync({
                      meetingId: meeting.id,
                      method,
                      sourceText,
                    })
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
            key: 'outreach',
            label: 'Outreach',
            children: (
              <OutreachView
                clients={activeClients}
                selectedClientId={selectedClientId}
                aiConfigured={Boolean(capabilities.data?.ai.activeProvider)}
              />
            ),
          },
          {
            key: 'reports',
            label: 'Reports',
            children: (
              <ReportsView
                report={report.data}
                loading={report.isLoading}
                period={reportPeriod}
                onPeriodChange={setReportPeriod}
                statusFilter={reportStatusFilter}
                onStatusFilterChange={setReportStatusFilter}
                sort={reportSort}
                onSortChange={setReportSort}
                updating={updateReportTarget.isPending}
                onAddTarget={() => {
                  targetOfficeForm.setFieldsValue({ clientId: selectedClientId ?? undefined });
                  setTargetOfficeModalOpen(true);
                }}
                onExport={() => report.data && exportEngagementReportPdf(report.data)}
                onViewMeetings={setReportMeetingRow}
                onStatusChange={(row, field) =>
                  updateReportTarget.mutate({
                    row,
                    field,
                    status: nextReportStatus(row[field]),
                  })
                }
              />
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
        title="Add target office"
        open={targetOfficeModalOpen}
        onCancel={() => setTargetOfficeModalOpen(false)}
        onOk={() => targetOfficeForm.submit()}
        confirmLoading={createTargetOffice.isPending}
        width={640}
      >
        <Form
          form={targetOfficeForm}
          layout="vertical"
          onFinish={(values) => createTargetOffice.mutate(values)}
        >
          <Form.Item name="clientId" label="Client">
            <Select
              allowClear
              options={(clients.data ?? [])
                .filter((client) => client.status !== 'archived')
                .map((client) => ({ value: client.id, label: client.name }))}
            />
          </Form.Item>
          <Form.Item
            name="memberPrincipal"
            label="Member / Principal"
            rules={[{ required: true, min: 1 }]}
          >
            <Input placeholder="Rep. Jane Smith (D-CA-12)" />
          </Form.Item>
          <div className="engagement-form-grid">
            <Form.Item name="committee" label="Committee">
              <Input placeholder="HASC" />
            </Form.Item>
            <Form.Item name="building" label="Building">
              <Input placeholder="Rayburn" />
            </Form.Item>
            <Form.Item name="leadOwner" label="Lead">
              <Input placeholder="Owner" />
            </Form.Item>
          </div>
          <Form.Item name="staffer" label="Staffer">
            <Input placeholder="Staffer name" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={reportMeetingRow ? `${reportMeetingRow.memberPrincipal} meetings` : 'Meetings'}
        open={Boolean(reportMeetingRow)}
        onCancel={() => setReportMeetingRow(null)}
        footer={null}
        width={720}
      >
        <div className="engagement-report-meeting-list">
          {reportMeetingRow?.meetings.length ? (
            reportMeetingRow.meetings.map((meeting) => (
              <div className="engagement-calendar-row" key={meeting.id}>
                <span>{formatDateTime(meeting.startsAt)}</span>
                <div>
                  <Typography.Text strong>{meeting.subject}</Typography.Text>
                  <Typography.Text type="secondary">
                    {[formatTimeRange(meeting.startsAt, meeting.endsAt), meeting.location]
                      .filter(Boolean)
                      .join(' | ')}
                  </Typography.Text>
                </div>
                <Button
                  size="small"
                  icon={<ExportOutlined />}
                  disabled={!meeting.externalUrl}
                  href={meeting.externalUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open
                </Button>
              </div>
            ))
          ) : (
            <Empty description="No meetings are linked to this target office yet." />
          )}
        </div>
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

function ClientSelectorBar({
  clients,
  selectedClientId,
  onSelect,
}: {
  clients: Client[];
  selectedClientId: string | null;
  onSelect: (clientId: string | null) => void;
}) {
  const selected = selectedClientId ?? 'all';
  return (
    <div className="engagement-client-selector">
      <span>Client</span>
      <button
        type="button"
        className={selected === 'all' ? 'active' : ''}
        onClick={() => onSelect(null)}
      >
        <i />
        All
      </button>
      {clients.map((client) => (
        <button
          key={client.id}
          type="button"
          className={selected === client.id ? 'active' : ''}
          onClick={() => onSelect(client.id)}
        >
          <i>{initials(client.name).slice(0, 2)}</i>
          {client.name}
        </button>
      ))}
      {!clients.length ? (
        <Typography.Text type="secondary">
          Add a client to filter your view in the <a href="/clients">Clients</a> section.
        </Typography.Text>
      ) : null}
    </div>
  );
}

function MeetingListView({
  meetings,
  selectedId,
  rangeStart,
  rangeEnd,
  defaultRange,
  historyBatch,
  aiConfigured,
  generatingMeetingId,
  onRangeStart,
  onRangeEnd,
  onClearRange,
  onSelect,
  onGeneratePrep,
  onLoadMore,
}: {
  meetings: Meeting[];
  selectedId: string | null;
  rangeStart: string;
  rangeEnd: string;
  defaultRange: { start: string; end: string };
  historyBatch: number;
  aiConfigured: boolean;
  generatingMeetingId: string | null;
  onRangeStart: (value: string) => void;
  onRangeEnd: (value: string) => void;
  onClearRange: () => void;
  onSelect: (meeting: Meeting, tab?: string) => void;
  onGeneratePrep: (meeting: Meeting) => void;
  onLoadMore: () => void;
}) {
  const groups = groupMeetingsByLocalDate(meetings);
  const hasCustomRange =
    rangeStart !== defaultRange.start || rangeEnd !== defaultRange.end || historyBatch > 0;
  return (
    <div className="engagement-list-view">
      <div className="engagement-date-filter">
        <span>Date range</span>
        <Input
          type="date"
          value={rangeStart}
          onChange={(event) => onRangeStart(event.target.value)}
        />
        <Input type="date" value={rangeEnd} onChange={(event) => onRangeEnd(event.target.value)} />
        {hasCustomRange ? (
          <button type="button" onClick={onClearRange}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="engagement-agenda-list">
        {groups.map((group, index) => (
          <div className="engagement-date-group" key={group.key}>
            {group.isPast && !groups[index - 1]?.isPast ? (
              <div className="engagement-earlier-divider">
                <span />
                <strong>Earlier</strong>
                <span />
              </div>
            ) : null}
            <div className={`engagement-date-header${group.isToday ? ' today' : ''}`}>
              {group.isToday ? `Today - ${formatFullDay(group.date)}` : formatFullDay(group.date)}
            </div>
            {group.meetings.map((meeting) => (
              <MeetingListItem
                key={meeting.id}
                meeting={meeting}
                selected={meeting.id === selectedId}
                aiConfigured={aiConfigured}
                generating={generatingMeetingId === meeting.id}
                onSelect={(tab) => onSelect(meeting, tab)}
                onGeneratePrep={() => onGeneratePrep(meeting)}
              />
            ))}
          </div>
        ))}
        {historyBatch < 12 ? (
          <Button className="engagement-load-more" onClick={onLoadMore}>
            Load more meetings
          </Button>
        ) : null}
      </div>
    </div>
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
  onSelect: (tab?: string) => void;
  onGeneratePrep: () => void;
}) {
  const status = meetingStatus(meeting);
  return (
    <article
      className={`engagement-agenda-item engagement-agenda-item--${status.kind}${
        selected ? ' selected' : ''
      }`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect('prep')}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect('prep');
      }}
    >
      <div className="engagement-agenda-time">{meetingListTime(meeting)}</div>
      <div className="engagement-agenda-marker" />
      <div className="engagement-agenda-body">
        <Typography.Text strong title={meeting.subject}>
          {meeting.subject}
        </Typography.Text>
        <Typography.Text type="secondary">
          {[meeting.client?.name, meeting.location || sourceLabel(meeting.source)]
            .filter(Boolean)
            .join(' | ')}
        </Typography.Text>
        <div className="engagement-agenda-tags">
          {status.chips.map((chip) => (
            <Tag
              key={chip.label}
              className={`engagement-chip engagement-chip--${chip.tone}${
                chip.action ? ' engagement-chip--action' : ''
              }`}
              onClick={(event) => {
                if (!chip.action) return;
                event.stopPropagation();
                if (chip.action === 'prep') {
                  onSelect('prep');
                  onGeneratePrep();
                  return;
                }
                onSelect(chip.action);
              }}
            >
              {chip.label}
            </Tag>
          ))}
        </div>
      </div>
      <Button
        size="small"
        disabled={status.primaryAction === 'prep' && !aiConfigured}
        loading={generating}
        onClick={(event) => {
          event.stopPropagation();
          if (status.primaryAction === 'debrief') {
            onSelect('debrief');
            return;
          }
          if (status.primaryAction === 'prep') {
            onSelect('prep');
            onGeneratePrep();
            return;
          }
          onSelect('prep');
        }}
      >
        {status.actionLabel}
      </Button>
    </article>
  );
}

function MeetingListEmpty({
  hasAnySyncedMeetings,
  onSync,
}: {
  hasAnySyncedMeetings: boolean;
  onSync: () => void;
}) {
  return (
    <div className="engagement-list-empty">
      <Empty
        description={
          hasAnySyncedMeetings ? (
            <span>
              <strong>No meetings in this date range</strong>
              <br />
              Try expanding your date filter or syncing your calendar.
            </span>
          ) : (
            <span>
              <strong>No meetings yet</strong>
              <br />
              Connect your calendar to start seeing meetings here.
            </span>
          )
        }
      >
        {hasAnySyncedMeetings ? (
          <Button onClick={onSync}>Sync calendar</Button>
        ) : (
          <Button href="/settings/integrations">Go to Settings</Button>
        )}
      </Empty>
    </div>
  );
}

function MeetingCalendarList({
  meetings,
  selectedId,
  weekStart,
  weekEnd,
  onSelect,
  onAction,
  onPreviousWeek,
  onNextWeek,
}: {
  meetings: Meeting[];
  selectedId: string | null;
  weekStart: Date;
  weekEnd: Date;
  onSelect: (id: string) => void;
  onAction: (id: string, tab: string) => void;
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
                        {status.kind === 'missing' ? (
                          <em
                            onClick={(event) => {
                              event.stopPropagation();
                              onAction(meeting.id, 'debrief');
                            }}
                          >
                            Debrief missing -&gt;
                          </em>
                        ) : status.label ? (
                          <em>{status.label}</em>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <Typography.Text type="secondary">No meetings this week</Typography.Text>
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
  attachments,
  attachmentsLoading,
  debriefs,
  debriefsLoading,
  activeTab,
  onTabChange,
  debriefForm,
  currentUserId,
  notesConfigured,
  attachmentsConfigured,
  aiConfigured,
  generating,
  savingNote,
  uploadingTranscript,
  deletingAttachmentId,
  savingDebrief,
  generatingDebrief,
  approving,
  onGeneratePrep,
  onSaveNote,
  onUploadTranscript,
  onRemoveAttachment,
  onCreateDebrief,
  onGenerateDebrief,
  onEditPrep,
  onApprovePrep,
  onExportPdf,
}: {
  meeting: Meeting | null;
  context?: ClientContext;
  contextLoading: boolean;
  notes: MeetingNote[];
  notesLoading: boolean;
  attachments: EngagementAttachment[];
  attachmentsLoading: boolean;
  debriefs: MeetingDebrief[];
  debriefsLoading: boolean;
  activeTab: string;
  onTabChange: (key: string) => void;
  debriefForm: ReturnType<typeof Form.useForm<{ body: string }>>[0];
  currentUserId: string | null;
  notesConfigured: boolean;
  attachmentsConfigured: boolean;
  aiConfigured: boolean;
  generating: boolean;
  savingNote: boolean;
  uploadingTranscript: boolean;
  deletingAttachmentId: string | null;
  savingDebrief: boolean;
  generatingDebrief: boolean;
  approving: boolean;
  onGeneratePrep: (meeting: Meeting) => void;
  onSaveNote: (meeting: Meeting, noteId: string | null, body: string) => Promise<MeetingNote>;
  onUploadTranscript: (meeting: Meeting, file: File) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onCreateDebrief: (meeting: Meeting, body: string) => void;
  onGenerateDebrief: (
    meeting: Meeting,
    method: 'upload' | 'manual' | 'voice',
    sourceText: string,
  ) => Promise<MeetingDebriefDraft>;
  onEditPrep: (meeting: Meeting, prep: MeetingPrep) => void;
  onApprovePrep: (prep: MeetingPrep) => void;
  onExportPdf: (meeting: Meeting) => void;
}) {
  if (!meeting) {
    return (
      <div className="engagement-panel engagement-detail-panel">
        <div className="engagement-detail-empty">
          <CalendarOutlined />
          <Typography.Text strong>Select a meeting to view details</Typography.Text>
        </div>
      </div>
    );
  }

  const prep = meeting.preps[0];
  const participants = meetingParticipants(meeting);
  const status = meetingStatus(meeting);
  const meetingHasEnded = new Date(meeting.endsAt).getTime() < Date.now();

  return (
    <aside className="engagement-panel engagement-detail-panel">
      <div className="engagement-detail-head">
        <div>
          <Typography.Title level={5}>{meeting.subject}</Typography.Title>
          <Typography.Text type="secondary">
            {[
              formatLongDate(meeting.startsAt),
              formatTimeRange(meeting.startsAt, meeting.endsAt),
              meeting.location,
              meeting.client?.name,
            ]
              .filter(Boolean)
              .join(' | ')}
          </Typography.Text>
          {status.kind === 'missing' ? (
            <Typography.Text className="engagement-detail-warning">
              Debrief not completed
            </Typography.Text>
          ) : null}
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
                      <Typography.Text strong>No prep notes yet</Typography.Text>
                      {!meeting.client ? (
                        <Typography.Text type="secondary">
                          Clio needs more context to generate prep.{' '}
                          <a href="/clients">Go to client profile</a>
                        </Typography.Text>
                      ) : (
                        <Typography.Text type="secondary">
                          Generate prep from the client profile, participant profiles, prior meeting
                          history, and congressional context.
                        </Typography.Text>
                      )}
                      <Button
                        type="primary"
                        disabled={!aiConfigured || !meeting.client}
                        loading={generating}
                        onClick={() => onGeneratePrep(meeting)}
                      >
                        {generating ? 'Clio is preparing your brief...' : 'Generate prep'}
                      </Button>
                    </div>
                  )}
                  <ParticipantsList participants={participants} />
                </div>
              ),
            },
            {
              key: 'debrief',
              label: 'Debrief',
              children: (
                <DebriefPanel
                  meeting={meeting}
                  prep={prep}
                  debriefs={debriefs}
                  loading={debriefsLoading}
                  aiConfigured={aiConfigured}
                  notesConfigured={notesConfigured}
                  attachmentsConfigured={attachmentsConfigured}
                  attachments={attachments}
                  attachmentsLoading={attachmentsLoading}
                  uploadingTranscript={uploadingTranscript}
                  deletingAttachmentId={deletingAttachmentId}
                  saving={savingDebrief}
                  generating={generatingDebrief}
                  onUpload={(file) => onUploadTranscript(meeting, file)}
                  onRemoveAttachment={onRemoveAttachment}
                  onGenerate={(method, sourceText) =>
                    onGenerateDebrief(meeting, method, sourceText)
                  }
                  onApprove={(body) => onCreateDebrief(meeting, body)}
                />
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
      {activeTab === 'prep' && prep ? (
        <div className="engagement-detail-actions">
          <Button
            icon={<RobotOutlined />}
            loading={generating}
            onClick={() => onGeneratePrep(meeting)}
          >
            Regenerate
          </Button>
          <Button
            icon={<EditOutlined />}
            onClick={() => {
              onEditPrep(meeting, prep);
            }}
          >
            Edit
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => onExportPdf(meeting)}>
            Export PDF
          </Button>
          <Button
            type="primary"
            className={prep.status === 'approved' ? 'engagement-approved-button' : undefined}
            loading={approving}
            onClick={() => {
              if (prep.status !== 'approved') onApprovePrep(prep);
            }}
          >
            {prep.status === 'approved' ? 'Approved' : 'Approve'}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

function MeetingNotesEditor({
  meeting,
  notes,
  notesLoading,
  attachments,
  attachmentsLoading,
  currentUserId,
  notesConfigured,
  attachmentsConfigured,
  meetingHasEnded,
  saving,
  uploadingTranscript,
  deletingAttachmentId,
  onSave,
  onUpload,
  onRemoveAttachment,
}: {
  meeting: Meeting;
  notes: MeetingNote[];
  notesLoading: boolean;
  attachments: EngagementAttachment[];
  attachmentsLoading: boolean;
  currentUserId: string | null;
  notesConfigured: boolean;
  attachmentsConfigured: boolean;
  meetingHasEnded: boolean;
  saving: boolean;
  uploadingTranscript: boolean;
  deletingAttachmentId: string | null;
  onSave: (noteId: string | null, body: string) => Promise<MeetingNote>;
  onUpload: (file: File) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  const editableNote = useMemo(
    () =>
      notes.find(
        (note) => !note.restricted && currentUserId && note.authorUserId === currentUserId,
      ) ?? null,
    [currentUserId, notes],
  );
  const [draft, setDraft] = useState(editableNote?.body ?? '');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(editableNote?.id ?? null);
  const [lastSavedBody, setLastSavedBody] = useState(editableNote?.body ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const transcriptInputId = `meeting-transcript-${meeting.id}`;

  useEffect(() => {
    const nextBody = editableNote?.body ?? '';
    setDraft(nextBody);
    setActiveNoteId(editableNote?.id ?? null);
    setLastSavedBody(nextBody);
    setSaveState('idle');
  }, [editableNote?.body, editableNote?.id, meeting.id]);

  useEffect(() => {
    if (!notesConfigured) return;
    const body = draft.trimEnd();
    if (!body.trim() || body === lastSavedBody || saving) return;

    const timeout = window.setTimeout(() => {
      setSaveState('saving');
      onSave(activeNoteId, body)
        .then((note) => {
          setActiveNoteId(note.id);
          setLastSavedBody(body);
          setSaveState('saved');
          window.setTimeout(() => setSaveState('idle'), 1400);
        })
        .catch(() => setSaveState('error'));
    }, 2000);

    return () => window.clearTimeout(timeout);
  }, [activeNoteId, draft, lastSavedBody, notesConfigured, onSave, saving]);

  return (
    <div className="engagement-detail-stack engagement-notes-tab">
      <div className="engagement-live-note">
        <div className="engagement-live-note-head">
          <Typography.Text strong>Meeting Notes</Typography.Text>
          <Typography.Text type={saveState === 'error' ? 'danger' : 'secondary'}>
            {saveState === 'saving'
              ? 'Saving...'
              : saveState === 'saved'
                ? 'Saved'
                : saveState === 'error'
                  ? 'Autosave failed'
                  : notesConfigured
                    ? 'Autosaves every 2 seconds'
                    : 'Encrypted notes unavailable'}
          </Typography.Text>
        </div>
        <Input.TextArea
          rows={12}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            meetingHasEnded && !notes.length
              ? 'No notes were taken for this meeting'
              : 'Start typing your notes here...'
          }
          disabled={!notesConfigured}
        />
        {!notesConfigured ? (
          <Typography.Text type="secondary">
            Encrypted notes require NOTES_ENCRYPTION_KEY on the API.
          </Typography.Text>
        ) : null}
      </div>

      <div className="engagement-transcript-uploader">
        <div>
          <Typography.Text strong>Transcript</Typography.Text>
          <Typography.Text type="secondary">
            Upload .txt, .docx, audio, or video files for this meeting.
          </Typography.Text>
        </div>
        <input
          id={transcriptInputId}
          className="engagement-file-input"
          type="file"
          accept=".txt,.docx,audio/*,video/*"
          disabled={!attachmentsConfigured || uploadingTranscript}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onUpload(file);
          }}
        />
        <Button
          icon={<UploadOutlined />}
          loading={uploadingTranscript}
          disabled={!attachmentsConfigured}
          onClick={() => document.getElementById(transcriptInputId)?.click()}
        >
          Upload transcript
        </Button>
        {!attachmentsConfigured ? (
          <Typography.Text type="secondary">
            Transcript uploads require ASSETS_BUCKET on the API.
          </Typography.Text>
        ) : null}
        <div className="engagement-attachment-list">
          {attachmentsLoading ? (
            <Typography.Text type="secondary">Loading transcripts...</Typography.Text>
          ) : attachments.length ? (
            attachments.map((attachment) => (
              <article className="engagement-attachment-entry" key={attachment.id}>
                <FileTextOutlined />
                <div>
                  {attachment.downloadUrl ? (
                    <a href={attachment.downloadUrl} target="_blank" rel="noreferrer">
                      {attachment.fileName}
                    </a>
                  ) : (
                    <Typography.Text>{attachment.fileName}</Typography.Text>
                  )}
                  <Typography.Text type="secondary">
                    {[attachment.contentType, formatBytes(attachment.byteSize)]
                      .filter(Boolean)
                      .join(' | ')}
                  </Typography.Text>
                </div>
                <Button
                  type="link"
                  danger
                  loading={deletingAttachmentId === attachment.id}
                  onClick={() => onRemoveAttachment(attachment.id)}
                >
                  Remove
                </Button>
              </article>
            ))
          ) : (
            <Typography.Text type="secondary">No transcript uploaded yet.</Typography.Text>
          )}
        </div>
      </div>

      <div className="engagement-note-history">
        <Typography.Text strong>Previous Notes</Typography.Text>
        {notesLoading ? (
          <Typography.Text type="secondary">Loading notes...</Typography.Text>
        ) : notes.length ? (
          notes.map((note) => (
            <article className="engagement-note-entry" key={note.id}>
              <div>
                <Typography.Text strong>{noteAuthor(note)}</Typography.Text>
                <Typography.Text type="secondary">{formatDateTime(note.createdAt)}</Typography.Text>
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
    </div>
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

function DebriefPanel({
  meeting,
  prep,
  debriefs,
  loading,
  aiConfigured,
  saving,
  notesConfigured,
  attachmentsConfigured,
  attachments,
  attachmentsLoading,
  uploadingTranscript,
  deletingAttachmentId,
  generating,
  onUpload,
  onRemoveAttachment,
  onGenerate,
  onApprove,
}: {
  meeting: Meeting;
  prep?: MeetingPrep;
  debriefs: MeetingDebrief[];
  loading: boolean;
  aiConfigured: boolean;
  saving: boolean;
  generating: boolean;
  notesConfigured: boolean;
  attachmentsConfigured: boolean;
  attachments: EngagementAttachment[];
  attachmentsLoading: boolean;
  uploadingTranscript: boolean;
  deletingAttachmentId: string | null;
  onUpload: (file: File) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onGenerate: (
    method: 'upload' | 'manual' | 'voice',
    sourceText: string,
  ) => Promise<MeetingDebriefDraft>;
  onApprove: (body: string) => void;
}) {
  const { message } = App.useApp();
  const meetingHasEnded = new Date(meeting.endsAt).getTime() < Date.now();
  const latestDebrief = debriefs[0];
  const initialDraft = useMemo(
    () => parseDebriefBody(latestDebrief?.body ?? ''),
    [latestDebrief?.body],
  );
  const [method, setMethod] = useState<'upload' | 'manual' | 'voice'>('manual');
  const [sourceText, setSourceText] = useState('');
  const [draft, setDraft] = useState(initialDraft);
  const [draftDirty, setDraftDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [uploadHint, setUploadHint] = useState('');
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcriptInputId = `debrief-transcript-${meeting.id}`;

  useEffect(() => {
    setMethod('manual');
    setSourceText('');
    setDraft(parseDebriefBody(latestDebrief?.body ?? ''));
    setDraftDirty(false);
    setEditing(false);
    setUploadHint('');
  }, [latestDebrief?.body, meeting.id]);

  const hasOutput = Boolean(draft.recap || draft.actionItems.length || draft.notes);
  const approved = Boolean(latestDebrief) && !draftDirty && !editing;

  const handleUpload = async (file: File) => {
    setMethod('upload');
    setUploadHint('');
    onUpload(file);
    if (file.type.startsWith('text/') || /\.txt$/i.test(file.name)) {
      setSourceText(await file.text());
      return;
    }
    setUploadHint(
      'File uploaded. Paste transcript text or type meeting notes below before generating.',
    );
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      message.error('Voice memo recording is not supported in this browser.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      message.error(errorMessage(error));
      return;
    }
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      const file = new File([blob], `${safeFileName(meeting.subject)}-voice-memo.webm`, {
        type: blob.type || 'audio/webm',
      });
      onUpload(file);
      setRecording(false);
      setUploadHint('Voice memo saved. Type meeting notes below before generating a debrief.');
    };
    setMethod('voice');
    setRecording(true);
    recorder.start();
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

  const generate = async () => {
    const source = sourceText.trim() || formatDebriefBody(draft).trim();
    if (!source) {
      message.warning('Add meeting notes or transcript text before generating a debrief.');
      return;
    }
    const next = await onGenerate(method, source);
    setDraft({
      recap: next.recap,
      actionItems: next.actionItems,
      notes: next.notes,
    });
    setDraftDirty(true);
    setEditing(false);
  };

  if (!meetingHasEnded) {
    return (
      <div className="engagement-detail-stack">
        <div className="engagement-empty-prep">
          <ClockCircleOutlined />
          <Typography.Text strong>This meeting hasn't taken place yet</Typography.Text>
          <Typography.Text type="secondary">
            Come back after the meeting to complete your debrief.
          </Typography.Text>
        </div>
      </div>
    );
  }

  return (
    <div className="engagement-debrief-panel">
      <div className="engagement-detail-stack engagement-debrief-scroll">
        <Typography.Text type="secondary">
          Input notes from your completed meeting to generate a debrief.
        </Typography.Text>
        <div className="engagement-debrief-option-grid">
          <button
            type="button"
            className={method === 'upload' ? 'selected' : ''}
            onClick={() => {
              setMethod('upload');
              document.getElementById(transcriptInputId)?.click();
            }}
          >
            <strong>Upload recording or transcript</strong>
            <span>Accepts audio, video, .txt, or .docx files.</span>
          </button>
          <button
            type="button"
            className={method === 'voice' ? 'selected' : ''}
            onClick={recording ? stopRecording : startRecording}
          >
            <strong>Record voice memo</strong>
            <span>
              {recording ? 'Recording... click to stop.' : 'Capture audio directly in the browser.'}
            </span>
          </button>
          <button
            type="button"
            className={method === 'manual' ? 'selected' : ''}
            onClick={() => setMethod('manual')}
          >
            <strong>Type notes manually</strong>
            <span>Use written context for the generated debrief.</span>
          </button>
        </div>
        <input
          id={transcriptInputId}
          className="engagement-file-input"
          type="file"
          accept=".txt,.docx,audio/*,video/*"
          disabled={!attachmentsConfigured || uploadingTranscript}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void handleUpload(file);
          }}
        />
        {uploadHint ? <Typography.Text type="secondary">{uploadHint}</Typography.Text> : null}

        <Input.TextArea
          rows={5}
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value)}
          placeholder="Capture outcomes, decisions, commitments, and next steps..."
        />

        <Button
          type="primary"
          block
          loading={generating}
          disabled={!aiConfigured}
          onClick={generate}
        >
          Generate debrief
        </Button>

        <div className="outreach-context-note">
          <RobotOutlined />
          <span>
            Already available to Clio: {prep ? 'approved or saved prep notes, ' : ''}
            {meeting.attendees.length} participant profiles,{' '}
            {meeting.client ? 'client profile, ' : ''}
            prior meeting history.
          </span>
        </div>

        <div className="engagement-attachment-list">
          {attachmentsLoading ? (
            <Typography.Text type="secondary">Loading uploaded files...</Typography.Text>
          ) : attachments.length ? (
            attachments.map((attachment) => (
              <article className="engagement-attachment-entry" key={attachment.id}>
                <FileTextOutlined />
                <div>
                  {attachment.downloadUrl ? (
                    <a href={attachment.downloadUrl} target="_blank" rel="noreferrer">
                      {attachment.fileName}
                    </a>
                  ) : (
                    <Typography.Text>{attachment.fileName}</Typography.Text>
                  )}
                  <Typography.Text type="secondary">
                    {[attachment.contentType, formatBytes(attachment.byteSize)]
                      .filter(Boolean)
                      .join(' | ')}
                  </Typography.Text>
                </div>
                <Button
                  type="link"
                  danger
                  loading={deletingAttachmentId === attachment.id}
                  onClick={() => onRemoveAttachment(attachment.id)}
                >
                  Remove
                </Button>
              </article>
            ))
          ) : null}
        </div>

        {loading ? <Typography.Text type="secondary">Loading debrief...</Typography.Text> : null}
        {hasOutput ? (
          <div className="engagement-debrief-output">
            <DetailBlock title="Recap">
              {editing ? (
                <Input.TextArea
                  rows={4}
                  value={draft.recap}
                  onChange={(event) => {
                    setDraft({ ...draft, recap: event.target.value });
                    setDraftDirty(true);
                  }}
                />
              ) : (
                <Typography.Paragraph>{draft.recap || 'No recap saved.'}</Typography.Paragraph>
              )}
            </DetailBlock>
            <DetailBlock title="Action Items">
              {editing ? (
                <Input.TextArea
                  rows={5}
                  value={draft.actionItems.join('\n')}
                  onChange={(event) => {
                    setDraft({ ...draft, actionItems: linesToArray(event.target.value) });
                    setDraftDirty(true);
                  }}
                />
              ) : (
                <BulletList items={draft.actionItems} empty="No action items generated yet." />
              )}
            </DetailBlock>
            <DetailBlock title="Notes">
              {editing ? (
                <Input.TextArea
                  rows={5}
                  value={draft.notes}
                  onChange={(event) => {
                    setDraft({ ...draft, notes: event.target.value });
                    setDraftDirty(true);
                  }}
                />
              ) : (
                <Typography.Paragraph>{draft.notes || 'No notes saved.'}</Typography.Paragraph>
              )}
            </DetailBlock>
          </div>
        ) : null}
      </div>

      {hasOutput ? (
        <div className="engagement-detail-actions engagement-debrief-actions">
          <Button icon={<RobotOutlined />} loading={generating} onClick={generate}>
            Regenerate
          </Button>
          <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => exportDebriefPdf({ meeting, draft })}>
            Export PDF
          </Button>
          <Button
            type="primary"
            className={approved ? 'engagement-approved-button' : undefined}
            loading={saving}
            disabled={!notesConfigured}
            onClick={() => {
              if (approved) return;
              onApprove(formatDebriefBody(draft));
              setEditing(false);
            }}
          >
            {approved ? 'Approved' : 'Approve'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DebriefCompleteView({
  debriefs,
  loading,
}: {
  debriefs: MeetingDebrief[];
  loading: boolean;
}) {
  if (loading) return <Typography.Text type="secondary">Loading debrief...</Typography.Text>;
  const latest = debriefs[0];
  return (
    <div className="engagement-debrief-complete">
      <DetailBlock title="Meeting Recap">
        <Typography.Paragraph>
          {latest?.restricted
            ? 'This confidential debrief is restricted.'
            : latest?.body || 'No recap text was saved.'}
        </Typography.Paragraph>
      </DetailBlock>
      <DetailBlock title="Action Items">
        <Typography.Text type="secondary">
          No separate action items were saved for this debrief yet.
        </Typography.Text>
      </DetailBlock>
      <DetailBlock title="Notes">
        <div className="engagement-note-history">
          {debriefs.map((debrief) => (
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
          ))}
        </div>
      </DetailBlock>
    </div>
  );
}

function DebriefWizard({
  meeting,
  context,
  prep,
  notesConfigured,
  aiConfigured,
  generating,
  saving,
  onCancel,
  onGenerate,
  onFinish,
}: {
  meeting: Meeting;
  context?: ClientContext;
  prep?: MeetingPrep;
  notesConfigured: boolean;
  aiConfigured: boolean;
  generating: boolean;
  saving: boolean;
  onCancel: () => void;
  onGenerate: (
    method: 'upload' | 'manual' | 'voice',
    sourceText: string,
  ) => Promise<MeetingDebriefDraft>;
  onFinish: (body: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [method, setMethod] = useState<'upload' | 'manual' | 'voice' | null>(null);
  const [input, setInput] = useState('');
  const [recap, setRecap] = useState('');
  const [actions, setActions] = useState('');
  const [notes, setNotes] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [approved, setApproved] = useState({ recap: false, actions: false, notes: false });

  const canContinue =
    (step === 1 && Boolean(method) && input.trim().length > 0 && aiConfigured) ||
    (step === 2 && Boolean(recap || actions || notes) && !generating) ||
    (step === 3 && approved.recap && approved.actions && approved.notes) ||
    step === 4;

  const generateFromInput = async () => {
    if (!method) return;
    setGenerationError('');
    setStep(2);
    try {
      const draft = await onGenerate(method, input.trim());
      setRecap(draft.recap);
      setActions(draft.actionItems.map((item) => `- ${item}`).join('\n'));
      setNotes(draft.notes);
    } catch (error) {
      setGenerationError(errorMessage(error));
    }
  };

  return (
    <div className="outreach-workflow engagement-debrief-wizard">
      <div className="outreach-workflow-head">
        <Typography.Title level={3}>Meeting Debrief</Typography.Title>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
      <div className="outreach-flow-body">
        <DebriefWorkflowSteps
          current={step}
          steps={[
            ['Capture input', 'Recording, transcript, or notes'],
            ['Generate', 'Create debrief outputs'],
            ['Review & approve', 'Edit and approve each panel'],
            ['Send', 'Prepare team and client copies'],
          ]}
        />
        <main className="outreach-flow-panel">
          {step === 1 ? (
            <div className="outreach-flow-stack">
              <Typography.Title level={4}>Capture meeting input</Typography.Title>
              <Typography.Paragraph type="secondary">
                Recording or transcript uploads provide the richest output. Manual notes work when
                you need a fast capture.
              </Typography.Paragraph>
              <div className="engagement-debrief-option-grid">
                <button
                  type="button"
                  className={method === 'upload' ? 'recommended selected' : 'recommended'}
                  onClick={() => setMethod('upload')}
                >
                  <strong>Upload recording or transcript</strong>
                  <span>Attach files in Notes, then paste transcript text here for drafting.</span>
                </button>
                <button
                  type="button"
                  className={method === 'manual' ? 'selected' : ''}
                  onClick={() => setMethod('manual')}
                >
                  <strong>Type notes manually</strong>
                  <span>Use typed notes plus pre-loaded context.</span>
                </button>
              </div>
              <Button disabled onClick={() => setMethod('voice')}>
                Record voice memo
              </Button>
              <Input.TextArea
                rows={8}
                value={input}
                placeholder="Paste or type debrief source notes or transcript text here..."
                onChange={(event) => setInput(event.target.value)}
              />
              {!aiConfigured ? (
                <Typography.Text type="danger">
                  Connect an AI provider before generating debriefs.
                </Typography.Text>
              ) : null}
              <div className="outreach-context-note">
                <RobotOutlined />
                <span>
                  Pre-loaded context: {prep ? 'prep notes, ' : ''}
                  participant profiles, {meeting.client ? 'client profile, ' : ''}
                  {context ? 'client activity summary, ' : ''}prior meeting history.
                </span>
              </div>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="outreach-flow-stack">
              <Typography.Title level={4}>
                {generating ? 'Clio is generating your debrief...' : 'Debrief draft generated'}
              </Typography.Title>
              <Typography.Paragraph type="secondary">
                This screen only uses the source material available in this tenant. No sent state is
                recorded until you approve and save.
              </Typography.Paragraph>
              {generationError ? (
                <Typography.Text type="danger">{generationError}</Typography.Text>
              ) : null}
              <DebriefOutputPanels recap={recap} actions={actions} notes={notes} readOnly />
            </div>
          ) : null}
          {step === 3 ? (
            <div className="outreach-flow-stack">
              <Typography.Title level={4}>Review & approve</Typography.Title>
              <DebriefEditablePanels
                recap={recap}
                actions={actions}
                notes={notes}
                approved={approved}
                onRecap={setRecap}
                onActions={setActions}
                onNotes={setNotes}
                onApproved={setApproved}
              />
            </div>
          ) : null}
          {step === 4 ? (
            <div className="outreach-flow-stack">
              <Typography.Title level={4}>Send</Typography.Title>
              <div className="engagement-debrief-send-grid">
                <section>
                  <Typography.Text strong>Team copy</Typography.Text>
                  <Typography.Text type="secondary">
                    Opens as a connected-email draft for your internal team.
                  </Typography.Text>
                  <Button disabled>Preview</Button>
                </section>
                <section>
                  <Typography.Text strong>Client copy</Typography.Text>
                  <Typography.Text type="secondary">
                    Client POC: {meeting.client?.primaryContactEmail ?? 'No POC email on profile'}
                  </Typography.Text>
                  <Button disabled>Preview</Button>
                </section>
              </div>
            </div>
          ) : null}
        </main>
      </div>
      <div className="outreach-workflow-footer">
        <Button disabled={step === 1 || saving} onClick={() => setStep((value) => value - 1)}>
          Back
        </Button>
        <span>Step {step} of 4</span>
        <div className="outreach-progress">
          <i style={{ width: `${(step / 4) * 100}%` }} />
        </div>
        <Button
          type="primary"
          loading={saving}
          disabled={!canContinue || !notesConfigured}
          onClick={() => {
            if (step === 1) {
              void generateFromInput();
              return;
            }
            if (step === 2) {
              setStep(3);
              return;
            }
            if (step === 3) {
              setStep(4);
              return;
            }
            onFinish(
              [`Meeting recap\n${recap}`, `Action items\n${actions}`, `Notes\n${notes}`].join(
                '\n\n',
              ),
            );
          }}
        >
          {step === 4 ? 'Finish' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}

function DebriefWorkflowSteps({
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
          <div
            className={step === current ? 'active' : step < current ? 'complete' : ''}
            key={title}
          >
            <span>{step < current ? <CheckCircleOutlined /> : step}</span>
            <strong>{title}</strong>
            <small>{description}</small>
          </div>
        );
      })}
    </aside>
  );
}

function DebriefOutputPanels({
  recap,
  actions,
  notes,
  readOnly,
}: {
  recap: string;
  actions: string;
  notes: string;
  readOnly?: boolean;
}) {
  return (
    <div className="engagement-debrief-panels">
      <section>
        <Typography.Text strong>Recap</Typography.Text>
        <Typography.Paragraph>{recap || 'Pending...'}</Typography.Paragraph>
      </section>
      <section>
        <Typography.Text strong>Action items</Typography.Text>
        <Typography.Paragraph>{actions || 'No action items generated yet.'}</Typography.Paragraph>
      </section>
      <section>
        <Typography.Text strong>Notes</Typography.Text>
        <Typography.Paragraph>{notes || 'Pending...'}</Typography.Paragraph>
      </section>
    </div>
  );
}

function DebriefEditablePanels({
  recap,
  actions,
  notes,
  approved,
  onRecap,
  onActions,
  onNotes,
  onApproved,
}: {
  recap: string;
  actions: string;
  notes: string;
  approved: { recap: boolean; actions: boolean; notes: boolean };
  onRecap: (value: string) => void;
  onActions: (value: string) => void;
  onNotes: (value: string) => void;
  onApproved: (value: { recap: boolean; actions: boolean; notes: boolean }) => void;
}) {
  return (
    <div className="engagement-debrief-panels editable">
      <section>
        <Typography.Text strong>Recap</Typography.Text>
        <Input.TextArea rows={8} value={recap} onChange={(event) => onRecap(event.target.value)} />
        <label>
          <input
            type="checkbox"
            checked={approved.recap}
            onChange={(event) => onApproved({ ...approved, recap: event.target.checked })}
          />{' '}
          Approve
        </label>
      </section>
      <section>
        <Typography.Text strong>Action items</Typography.Text>
        <Input.TextArea
          rows={8}
          value={actions}
          onChange={(event) => onActions(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={approved.actions}
            onChange={(event) => onApproved({ ...approved, actions: event.target.checked })}
          />{' '}
          Approve
        </label>
      </section>
      <section>
        <Typography.Text strong>Notes</Typography.Text>
        <Input.TextArea rows={8} value={notes} onChange={(event) => onNotes(event.target.value)} />
        <label>
          <input
            type="checkbox"
            checked={approved.notes}
            onChange={(event) => onApproved({ ...approved, notes: event.target.checked })}
          />{' '}
          Approve
        </label>
      </section>
    </div>
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

function ReportsView({
  report,
  loading,
  period,
  onPeriodChange,
  statusFilter,
  onStatusFilterChange,
  sort,
  onSortChange,
  updating,
  onAddTarget,
  onExport,
  onViewMeetings,
  onStatusChange,
}: {
  report?: EngagementReport;
  loading: boolean;
  period: ReportPeriod;
  onPeriodChange: (period: ReportPeriod) => void;
  statusFilter: 'all' | ReportStatus;
  onStatusFilterChange: (status: 'all' | ReportStatus) => void;
  sort: string;
  onSortChange: (sort: string) => void;
  updating: boolean;
  onAddTarget: () => void;
  onExport: () => void;
  onViewMeetings: (row: EngagementReportRow) => void;
  onStatusChange: (row: EngagementReportRow, field: ReportStatusField) => void;
}) {
  const rows = useMemo(() => {
    const base = report?.rows ?? [];
    const filtered =
      statusFilter === 'all'
        ? base
        : base.filter(
            (row) =>
              row.prepStatus === statusFilter ||
              row.outreachStatus === statusFilter ||
              row.submissionStatus === statusFilter,
          );
    return [...filtered].sort((left, right) => {
      if (sort === 'meetings-desc') return right.meetingsHeld - left.meetingsHeld;
      if (sort === 'outreach-desc') return right.outreachSent - left.outreachSent;
      if (sort === 'pending-desc') return right.pendingActions - left.pendingActions;
      if (sort === 'member-desc') return right.memberPrincipal.localeCompare(left.memberPrincipal);
      return left.memberPrincipal.localeCompare(right.memberPrincipal);
    });
  }, [report?.rows, sort, statusFilter]);

  const totalTargets = report?.summary.targetOffices ?? 0;

  return (
    <div className="engagement-report-page">
      <div className="engagement-report-topline">
        <div>
          <PanelTitle icon={<FileTextOutlined />} title="Reports" />
          <Typography.Text type="secondary">
            {report?.cycle.label ?? 'Current cycle'} engagement activity overview
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<DownloadOutlined />} disabled={!report} onClick={onExport}>
            Export
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={onAddTarget}>
            Add target office
          </Button>
        </Space>
      </div>

      <div className="engagement-report-metrics">
        <ReportMetric
          label="Target offices"
          value={report?.summary.targetOffices ?? 0}
          meta="this cycle"
        />
        <ReportMetric
          label="Meetings held"
          value={report?.summary.meetingsHeld ?? 0}
          meta={`of ${totalTargets} targets`}
        />
        <ReportMetric
          label="Outreach sent"
          value={report?.summary.outreachSent ?? 0}
          meta={`of ${totalTargets} targets`}
        />
        <ReportMetric
          label="Submissions filed"
          value={report?.summary.submissionsFiled ?? 0}
          meta={`of ${totalTargets} targets`}
        />
        <ReportMetric
          label="Pending actions"
          value={report?.summary.pendingActions ?? 0}
          meta="need follow-up"
        />
      </div>

      <div className="engagement-panel engagement-report-tracker">
        <div className="engagement-report-tracker-head">
          <div>
            <Typography.Title level={5}>Office engagement tracker</Typography.Title>
            <div className="engagement-report-period-tabs" aria-label="Report period">
              {(['current', 'previous', 'all'] as ReportPeriod[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={period === item ? 'active' : ''}
                  onClick={() => onPeriodChange(item)}
                >
                  {item === 'current'
                    ? 'Current cycle'
                    : item === 'previous'
                      ? 'Previous cycle'
                      : 'All time'}
                </button>
              ))}
            </div>
          </div>
          <Space wrap className="engagement-report-controls">
            <Select
              value={statusFilter}
              onChange={onStatusFilterChange}
              options={[
                { value: 'all', label: 'Filter: All statuses' },
                { value: 'complete', label: 'Filter: Complete' },
                { value: 'in_progress', label: 'Filter: In progress' },
                { value: 'not_started', label: 'Filter: Not started' },
              ]}
            />
            <Select
              value={sort}
              onChange={onSortChange}
              options={[
                { value: 'member-asc', label: 'Sort: Member A-Z' },
                { value: 'member-desc', label: 'Sort: Member Z-A' },
                { value: 'meetings-desc', label: 'Sort: Meetings held' },
                { value: 'outreach-desc', label: 'Sort: Outreach sent' },
                { value: 'pending-desc', label: 'Sort: Pending actions' },
              ]}
            />
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              disabled={!report}
              onClick={onExport}
            >
              Export to PDF
            </Button>
          </Space>
        </div>

        {loading ? (
          <Empty description="Loading report activity..." />
        ) : rows.length ? (
          <>
            <div className="engagement-report-table-wrap">
              <table className="engagement-report-table">
                <thead>
                  <tr>
                    <th>Member / Principal</th>
                    <th>Committee</th>
                    <th>Staffer</th>
                    <th>Building</th>
                    <th>Lead</th>
                    <th>Meetings held</th>
                    <th>Prep done</th>
                    <th>Outreach sent</th>
                    <th>Submission filed</th>
                    <th>Pending actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.scopeKey}:${row.officeKey}`}>
                      <td>
                        <Typography.Text strong>{row.memberPrincipal}</Typography.Text>
                        <Typography.Text type="secondary">
                          {[row.clientName, row.committee, row.building]
                            .filter(Boolean)
                            .join(' | ')}
                        </Typography.Text>
                      </td>
                      <td>{row.committee || '-'}</td>
                      <td>{row.staffer || '-'}</td>
                      <td>{row.building || '-'}</td>
                      <td>{row.leadOwner || '-'}</td>
                      <td>
                        <button
                          type="button"
                          className="engagement-report-link"
                          onClick={() => onViewMeetings(row)}
                        >
                          {row.meetingsHeld} view
                        </button>
                      </td>
                      <td>
                        <ReportStatusButton
                          status={row.prepStatus}
                          disabled={updating}
                          onClick={() => onStatusChange(row, 'prepStatus')}
                        />
                      </td>
                      <td>
                        <ReportStatusButton
                          status={row.outreachStatus}
                          disabled={updating}
                          onClick={() => onStatusChange(row, 'outreachStatus')}
                        />
                      </td>
                      <td>
                        <ReportStatusButton
                          status={row.submissionStatus}
                          disabled={updating}
                          onClick={() => onStatusChange(row, 'submissionStatus')}
                        />
                      </td>
                      <td>{row.pendingActions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="engagement-report-legend">
              <span>
                <i className="complete" /> Complete
              </span>
              <span>
                <i className="in-progress" /> In progress
              </span>
              <span>
                <i /> Not started
              </span>
              <em>Auto-populated from Capiro. Click a status dot to override manually.</em>
            </div>
          </>
        ) : (
          <Empty description="No target offices are linked to this reporting period yet." />
        )}
      </div>
    </div>
  );
}

function ReportMetric({ label, value, meta }: { label: string; value: number; meta: string }) {
  return (
    <div className="engagement-report-metric">
      <Typography.Text type="secondary">{label}</Typography.Text>
      <strong>{value}</strong>
      <span>{meta}</span>
    </div>
  );
}

function ReportStatusButton({
  status,
  disabled,
  onClick,
}: {
  status: ReportStatus;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`engagement-report-status engagement-report-status--${status}`}
      disabled={disabled}
      onClick={onClick}
      title="Click to override"
    >
      <i />
      <span>{reportStatusLabel(status)}</span>
    </button>
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

function groupMeetingsByLocalDate(meetings: Meeting[]): Array<{
  key: string;
  date: Date;
  isToday: boolean;
  isPast: boolean;
  meetings: Meeting[];
}> {
  const grouped = groupMeetingsByDate(meetings);
  const todayKey = localDateKey(new Date());
  return Array.from(grouped.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, rows]) => ({
      key,
      date: localDateFromInput(key),
      isToday: key === todayKey,
      isPast: key < todayKey,
      meetings: [...rows].sort(
        (left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime(),
      ),
    }));
}

function meetingStatus(meeting: Meeting): {
  kind: 'missing' | 'needs-prep' | 'prepped' | 'complete' | 'active';
  label: string;
  actionLabel: string;
  primaryAction: 'prep' | 'debrief' | 'open';
  chips: Array<{
    label: string;
    tone: 'default' | 'muted' | 'danger' | 'primary';
    action?: 'prep' | 'debrief';
  }>;
} {
  const hasDebrief = meeting.debriefs.length > 0;
  const start = new Date(meeting.startsAt).getTime();
  const end = new Date(meeting.endsAt).getTime();
  const now = Date.now();
  const hasEnded = end < now;
  const isActive = start <= now && end >= now;
  const prep = meeting.preps[0];
  if (hasEnded && !hasDebrief) {
    return {
      kind: 'missing',
      label: 'Debrief missing',
      actionLabel: 'Start debrief',
      primaryAction: 'debrief',
      chips: [{ label: 'Debrief missing', tone: 'danger', action: 'debrief' }],
    };
  }
  if (hasEnded && hasDebrief) {
    return {
      kind: 'complete',
      label: 'Debrief complete',
      actionLabel: 'View recap',
      primaryAction: 'debrief',
      chips: [{ label: 'Debrief complete', tone: 'muted' }],
    };
  }
  if (isActive) {
    return {
      kind: 'active',
      label: prep ? 'Prepped' : 'Generate prep ->',
      actionLabel: prep ? 'View prep' : 'Generate prep',
      primaryAction: prep ? 'open' : 'prep',
      chips: prep
        ? [{ label: prep.status === 'approved' ? 'Approved' : 'Prepped', tone: 'primary' }]
        : [{ label: 'Generate prep ->', tone: 'primary', action: 'prep' }],
    };
  }
  if (prep) {
    return {
      kind: 'prepped',
      label: prep.status === 'approved' ? 'Approved' : 'Prepped',
      actionLabel: 'View prep',
      primaryAction: 'open',
      chips: [{ label: prep.status === 'approved' ? 'Approved' : 'Prepped', tone: 'primary' }],
    };
  }
  return {
    kind: 'needs-prep',
    label: 'No prep yet',
    actionLabel: 'Generate prep',
    primaryAction: 'prep',
    chips: [
      { label: 'No prep yet', tone: 'muted' },
      { label: 'Generate prep ->', tone: 'default', action: 'prep' },
    ],
  };
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

function defaultMeetingRange(): { start: string; end: string } {
  const end = new Date();
  const start = addLocalDays(end, -30);
  return { start: inputValueFromDate(start), end: inputValueFromDate(end) };
}

function dateRangeWindow(start: string, end: string, historyBatch: number) {
  const from = localDateFromInput(start);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - historyBatch * 30);
  const to = localDateFromInput(end);
  to.setHours(23, 59, 59, 999);
  if (to <= from) {
    const fallback = addLocalDays(from, 1);
    fallback.setHours(23, 59, 59, 999);
    return { from: from.toISOString(), to: fallback.toISOString() };
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function formatFullDay(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(value);
}

function meetingListTime(meeting: Meeting): string {
  const key = localDateKey(meeting.startsAt);
  const today = localDateKey(new Date());
  if (key === today || key < today) return formatTime(meeting.startsAt);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(meeting.startsAt));
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

function nextReportStatus(status: ReportStatus): ReportStatus {
  if (status === 'not_started') return 'in_progress';
  if (status === 'in_progress') return 'complete';
  return 'not_started';
}

function reportStatusLabel(status: ReportStatus): string {
  if (status === 'complete') return 'Complete';
  if (status === 'in_progress') return 'In progress';
  return 'Not started';
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

function formatBytes(value: number | null): string {
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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

function exportEngagementReportPdf(report: EngagementReport) {
  const lines = [
    'Capiro Engagement Report',
    '',
    report.cycle.label,
    '',
    'Overview',
    `Target offices: ${report.summary.targetOffices}`,
    `Meetings held: ${report.summary.meetingsHeld}`,
    `Outreach sent: ${report.summary.outreachSent}`,
    `Submissions filed: ${report.summary.submissionsFiled}`,
    `Pending actions: ${report.summary.pendingActions}`,
    '',
    'Office Engagement Tracker',
    ...report.rows.flatMap((row) => [
      `${row.memberPrincipal}${row.clientName ? ` | ${row.clientName}` : ''}`,
      `Committee: ${row.committee || '-'} | Staffer: ${row.staffer || '-'} | Building: ${
        row.building || '-'
      } | Lead: ${row.leadOwner || '-'}`,
      `Meetings: ${row.meetingsHeld} | Outreach: ${row.outreachSent} | Prep: ${reportStatusLabel(
        row.prepStatus,
      )} | Submission: ${reportStatusLabel(row.submissionStatus)} | Pending: ${row.pendingActions}`,
      '',
    ]),
  ];

  const pdf = buildSimplePdf(lines.flatMap((line) => wrapPdfLine(line)));
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `engagement-report-${report.cycle.period}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function exportDebriefPdf({ meeting, draft }: { meeting: Meeting; draft: DebriefDraftState }) {
  const lines = [
    'Capiro Meeting Debrief',
    '',
    meeting.subject,
    `${formatLongDate(meeting.startsAt)} | ${formatTimeRange(meeting.startsAt, meeting.endsAt)}`,
    `Client: ${meeting.client?.name ?? 'Unlinked'}`,
    `Location: ${meeting.location || 'No location'}`,
    '',
    'Recap',
    draft.recap || 'No recap saved.',
    '',
    'Action Items',
    ...(draft.actionItems.length
      ? draft.actionItems.map((item) => `- ${item}`)
      : ['No action items saved.']),
    '',
    'Notes',
    draft.notes || 'No notes saved.',
  ];

  const pdf = buildSimplePdf(lines.flatMap((line) => wrapPdfLine(line)));
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(meeting.subject)}-debrief.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseDebriefBody(body: string): DebriefDraftState {
  const fallback = { recap: body.trim(), actionItems: [], notes: '' };
  if (!body.trim()) return { recap: '', actionItems: [], notes: '' };
  const recap = sectionText(body, 'Recap', 'Action Items');
  const actionItems = sectionText(body, 'Action Items', 'Notes');
  const notes = sectionText(body, 'Notes');
  if (!recap && !actionItems && !notes) return fallback;
  return {
    recap: recap || fallback.recap,
    actionItems: linesToArray(actionItems.replace(/^- /gm, '')),
    notes,
  };
}

function formatDebriefBody(draft: DebriefDraftState): string {
  return [
    'Recap',
    draft.recap.trim() || 'No recap saved.',
    '',
    'Action Items',
    ...(draft.actionItems.length
      ? draft.actionItems.map((item) => `- ${item}`)
      : ['No action items saved.']),
    '',
    'Notes',
    draft.notes.trim() || 'No notes saved.',
  ].join('\n');
}

function sectionText(body: string, start: string, end?: string): string {
  const startPattern = new RegExp(`(?:^|\\n)${escapeRegExp(start)}\\s*\\n`, 'i');
  const startMatch = body.match(startPattern);
  if (!startMatch || startMatch.index === undefined) return '';
  const contentStart = startMatch.index + startMatch[0].length;
  const rest = body.slice(contentStart);
  if (!end) return rest.trim();
  const endPattern = new RegExp(`\\n${escapeRegExp(end)}\\s*\\n`, 'i');
  const endMatch = rest.match(endPattern);
  return (endMatch?.index === undefined ? rest : rest.slice(0, endMatch.index)).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
