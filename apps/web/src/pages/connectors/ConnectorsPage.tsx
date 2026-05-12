import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CheckCircleFilled,
  CloudOutlined,
  CodeOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  GoogleOutlined,
  LinkOutlined,
  MailOutlined,
  MessageOutlined,
  ScheduleOutlined,
  ThunderboltOutlined,
  WindowsFilled,
} from '@ant-design/icons';
import { App as AntApp, Button, Card, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useApi } from '../../lib/use-api.js';
import './connectors.css';

const { Title, Text, Paragraph } = Typography;

interface IntegrationConnection {
  id: string;
  provider: 'microsoft_365' | string;
  accountEmail: string | null;
  displayName: string | null;
  status: 'needs_configuration' | 'connected' | 'error' | 'disabled';
}

/**
 * Each card represents one external system Clio can plug into.
 *
 *   `provider` matches a real backend EngagementProvider when wired —
 *   we look it up against /api/engagement/integrations to decide
 *   whether the card shows "Connected" or "Connect".
 *
 *   When `available: false`, the card renders disabled with a "Coming
 *   soon" badge. That's where the spec for MCP-based integrations is
 *   visible to the user without actually shipping each one.
 */
interface Connector {
  id: string;
  provider?: 'microsoft_365';
  name: string;
  blurb: string;
  icon: ReactNode;
  category: 'Identity & mail' | 'Files & drive' | 'Productivity' | 'Developer' | 'Knowledge';
  available: boolean;
  startUrl?: string;
}

const CONNECTORS: Connector[] = [
  {
    id: 'microsoft_365',
    provider: 'microsoft_365',
    name: 'Microsoft 365',
    blurb:
      'Outlook mail and calendar. Lets Clio read meeting context, draft replies, and pull mail thread history into briefings.',
    icon: <WindowsFilled style={{ color: '#0078d4' }} />,
    category: 'Identity & mail',
    available: true,
    startUrl: '/api/engagement/integrations/microsoft/start',
  },
  {
    id: 'google_workspace',
    name: 'Google Workspace',
    blurb: 'Gmail, Google Calendar, and Google Drive. Same shape as the Microsoft connector.',
    icon: <GoogleOutlined style={{ color: '#ea4335' }} />,
    category: 'Identity & mail',
    available: false,
  },
  {
    id: 'gmail',
    name: 'Gmail (personal)',
    blurb:
      'For users whose primary inbox isn\'t on Microsoft 365. Stand-alone Gmail OAuth, no calendar.',
    icon: <MailOutlined style={{ color: '#ea4335' }} />,
    category: 'Identity & mail',
    available: false,
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    blurb: 'Read upcoming meetings, draft invites, surface conflicts before Clio commits to a time.',
    icon: <ScheduleOutlined style={{ color: '#4285f4' }} />,
    category: 'Productivity',
    available: false,
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    blurb: 'Search and read Drive docs into Clio\'s context. Citations link back to the source file.',
    icon: <CloudOutlined style={{ color: '#1a73e8' }} />,
    category: 'Files & drive',
    available: false,
  },
  {
    id: 'sharepoint',
    name: 'SharePoint / OneDrive',
    blurb: 'Org documents on the Microsoft side. Already partway covered by the Microsoft 365 connector.',
    icon: <FileTextOutlined style={{ color: '#0078d4' }} />,
    category: 'Files & drive',
    available: false,
  },
  {
    id: 'slack',
    name: 'Slack',
    blurb:
      'Search Slack history for context, post Clio replies into channels, get notified when Clio finishes a long task.',
    icon: <MessageOutlined style={{ color: '#4a154b' }} />,
    category: 'Productivity',
    available: false,
  },
  {
    id: 'github',
    name: 'GitHub',
    blurb:
      'Repo search, issue and PR context, file reads. Clio becomes a code-aware teammate without leaving the chat.',
    icon: <CodeOutlined />,
    category: 'Developer',
    available: false,
  },
  {
    id: 'linear',
    name: 'Linear',
    blurb: 'Issue search, status sync, draft Linear issues from a chat thread.',
    icon: <ThunderboltOutlined style={{ color: '#5e6ad2' }} />,
    category: 'Productivity',
    available: false,
  },
  {
    id: 'notion',
    name: 'Notion',
    blurb: 'Search pages, draft new pages, attach Clio-rendered artifacts to existing docs.',
    icon: <DatabaseOutlined />,
    category: 'Knowledge',
    available: false,
  },
  {
    id: 'mcp_custom',
    name: 'Custom MCP server',
    blurb:
      'Bring your own MCP server URL. Clio discovers its tool list at connect time and exposes them to the agent.',
    icon: <LinkOutlined />,
    category: 'Developer',
    available: false,
  },
];

export function ConnectorsPage() {
  const api = useApi();
  const { message } = AntApp.useApp();

  // Surface the existing tenant-wide Microsoft 365 connection state so
  // the "Microsoft 365" card shows "Connected" when /settings/integrations
  // is already set up. Reusing the engagement endpoint avoids duplicating
  // OAuth plumbing for the same provider.
  const integrations = useQuery<IntegrationConnection[]>({
    queryKey: ['engagement', 'integrations'],
    queryFn: async () =>
      (await api.get<IntegrationConnection[]>('/api/engagement/integrations')).data,
  });

  const startMicrosoft = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ authorizationUrl: string }>(
        '/api/engagement/integrations/microsoft/start',
      );
      return res.data.authorizationUrl;
    },
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: () => message.error('Could not start the Microsoft connect flow'),
  });

  const byCategory = new Map<string, Connector[]>();
  for (const c of CONNECTORS) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }

  function statusFor(connector: Connector): { state: 'connected' | 'available' | 'soon'; tag?: ReactNode; email?: string } {
    if (!connector.available) return { state: 'soon', tag: <Tag>Coming soon</Tag> };
    const match = integrations.data?.find((i) => i.provider === connector.provider && i.status === 'connected');
    if (match) {
      return {
        state: 'connected',
        tag: (
          <Tag icon={<CheckCircleFilled />} color="green">
            Connected
          </Tag>
        ),
        email: match.accountEmail ?? undefined,
      };
    }
    return { state: 'available', tag: <Tag color="blue">Available</Tag> };
  }

  return (
    <div className="connectors-page">
      <header className="connectors-page__header">
        <Title level={3} style={{ margin: 0 }}>
          Connectors
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
          Plug Clio into the tools you already use. Each connector adds skills to the agent — reading
          your mail, searching your drive, drafting issues, posting Slack updates. Connect once;
          stays scoped to your user.
        </Paragraph>
      </header>

      {Array.from(byCategory.entries()).map(([category, items]) => (
        <section key={category} className="connectors-section">
          <Text className="connectors-section__title">{category}</Text>
          <div className="connectors-grid">
            {items.map((c) => {
              const status = statusFor(c);
              return (
                <Card
                  key={c.id}
                  className={`connector-card connector-card--${status.state}`}
                  size="small"
                  hoverable={status.state !== 'soon'}
                >
                  <div className="connector-card__top">
                    <div className="connector-card__icon" aria-hidden>
                      {c.icon}
                    </div>
                    <div className="connector-card__title">
                      <Text strong>{c.name}</Text>
                      {status.email ? (
                        <Text type="secondary" className="connector-card__email">
                          {status.email}
                        </Text>
                      ) : null}
                    </div>
                    {status.tag}
                  </div>
                  <Paragraph
                    type="secondary"
                    className="connector-card__blurb"
                    ellipsis={{ rows: 3 }}
                  >
                    {c.blurb}
                  </Paragraph>
                  <div className="connector-card__action">
                    {status.state === 'connected' ? (
                      <Button size="small" href="/settings/integrations">
                        Manage
                      </Button>
                    ) : status.state === 'available' && c.id === 'microsoft_365' ? (
                      <Button
                        size="small"
                        type="primary"
                        loading={startMicrosoft.isPending}
                        onClick={() => startMicrosoft.mutate()}
                      >
                        Connect
                      </Button>
                    ) : (
                      <Button size="small" disabled>
                        Connect
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
