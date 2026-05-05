import {
  CalendarOutlined,
  CheckCircleOutlined,
  MailOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Empty, List, Spin, Typography } from 'antd';
import { useApi } from '../lib/use-api.js';
import { useClientFilter } from '../state/client-filter.js';
import type { Client } from './clients/clientTypes.js';

interface CommandMeeting {
  id: string;
  subject: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  client: Pick<Client, 'id' | 'name'> | null;
}

interface CommandTask {
  id: string;
  title: string;
  dueDate: string | null;
  status: string;
  client: Pick<Client, 'id' | 'name'> | null;
}

interface CommandMailThread {
  id: string;
  subject: string;
  lastMessageAt: string | null;
  status: string;
  client: Pick<Client, 'id' | 'name'> | null;
}

export function HomePage() {
  const api = useApi();
  const { selectedClientId } = useClientFilter();
  const today = dateWindow(todayInputValue());

  const clients = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Client[]>('/api/clients')).data,
  });

  const meetings = useQuery<CommandMeeting[]>({
    queryKey: ['command-meetings', selectedClientId, today.from, today.to],
    queryFn: async () =>
      (
        await api.get<CommandMeeting[]>('/api/engagement/meetings', {
          params: { clientId: selectedClientId ?? undefined, from: today.from, to: today.to },
        })
      ).data,
  });

  const tasks = useQuery<CommandTask[]>({
    queryKey: ['command-tasks', selectedClientId],
    queryFn: async () =>
      (
        await api.get<CommandTask[]>('/api/engagement/tasks', {
          params: { clientId: selectedClientId ?? undefined },
        })
      ).data,
  });

  const mailThreads = useQuery<CommandMailThread[]>({
    queryKey: ['command-mail-threads', selectedClientId],
    queryFn: async () =>
      (
        await api.get<CommandMailThread[]>('/api/engagement/mail-threads', {
          params: { clientId: selectedClientId ?? undefined },
        })
      ).data,
  });

  const selectedClient = (clients.data ?? []).find((client) => client.id === selectedClientId);
  const activeClients = (clients.data ?? []).filter((client) => client.status !== 'archived');
  const openTasks = (tasks.data ?? []).filter((task) => task.status !== 'done');

  return (
    <section className="command-page">
      <div className="command-summary-grid">
        <CommandMetricCard
          icon={<CalendarOutlined />}
          label="Meetings Today"
          value={meetings.data?.length ?? 0}
          loading={meetings.isLoading}
        />
        <CommandMetricCard
          icon={<CheckCircleOutlined />}
          label="Open Follow-ups"
          value={openTasks.length}
          loading={tasks.isLoading}
        />
        <CommandMetricCard
          icon={<MailOutlined />}
          label="Relevant Mail Threads"
          value={mailThreads.data?.length ?? 0}
          loading={mailThreads.isLoading}
        />
        <CommandMetricCard
          icon={<TeamOutlined />}
          label={selectedClient ? 'Selected Client' : 'Active Clients'}
          value={selectedClient ? 1 : activeClients.length}
          loading={clients.isLoading}
        />
      </div>

      <div className="command-work-grid">
        <Card title="Today's Meetings">
          {meetings.isLoading ? (
            <Spin />
          ) : meetings.data?.length ? (
            <List
              dataSource={meetings.data.slice(0, 6)}
              renderItem={(meeting) => (
                <List.Item>
                  <List.Item.Meta
                    title={meeting.subject}
                    description={[
                      formatTimeRange(meeting.startsAt, meeting.endsAt),
                      meeting.client?.name,
                      meeting.location,
                    ]
                      .filter(Boolean)
                      .join(' | ')}
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty description="No client-matched meetings today." />
          )}
        </Card>

        <Card title="Suggested Actions">
          {tasks.isLoading ? (
            <Spin />
          ) : openTasks.length ? (
            <List
              dataSource={openTasks.slice(0, 6)}
              renderItem={(task) => (
                <List.Item>
                  <List.Item.Meta
                    title={task.title}
                    description={[task.client?.name, formatOptionalDate(task.dueDate)]
                      .filter(Boolean)
                      .join(' | ')}
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty description="No open follow-ups." />
          )}
        </Card>

        <Card className="command-wide-card" title="Relevant Mail">
          {mailThreads.isLoading ? (
            <Spin />
          ) : mailThreads.data?.length ? (
            <List
              dataSource={mailThreads.data.slice(0, 6)}
              renderItem={(thread) => (
                <List.Item>
                  <List.Item.Meta
                    title={thread.subject}
                    description={[thread.client?.name, formatOptionalDate(thread.lastMessageAt)]
                      .filter(Boolean)
                      .join(' | ')}
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty description="No relevant mail threads yet." />
          )}
        </Card>
      </div>
    </section>
  );
}

function CommandMetricCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  loading: boolean;
}) {
  return (
    <Card className="command-metric-card">
      <div className="command-metric-icon">{icon}</div>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Typography.Title level={3}>{loading ? '-' : value}</Typography.Title>
    </Card>
  );
}

function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function dateWindow(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const from = new Date(year ?? new Date().getFullYear(), (month ?? 1) - 1, day ?? 1);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function formatTimeRange(from: string, to: string): string {
  return `${formatTime(from)} - ${formatTime(to)}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}

function formatOptionalDate(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}
