import { useEffect, useState, type ReactNode } from 'react';
import {
  ApiOutlined,
  CloudSyncOutlined,
  GoogleOutlined,
  MailOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, Modal, Space, Tag, Typography } from 'antd';
import { useApi } from '../../lib/use-api.js';

type Provider = 'microsoft_365' | 'google_workspace' | 'imap_caldav';

interface IntegrationConnection {
  id: string;
  provider: Provider;
  accountEmail: string | null;
  displayName: string | null;
  status: 'needs_configuration' | 'connected' | 'error' | 'disabled';
  scopes: string[];
  lastSyncAt: string | null;
  lastError: string | null;
}

interface IntegrationFormValues {
  accountEmail?: string;
  displayName?: string;
}

const providers: Array<{
  key: Provider;
  title: string;
  icon: ReactNode;
  description: string;
}> = [
  {
    key: 'microsoft_365',
    title: 'Microsoft 365',
    icon: <CloudSyncOutlined />,
    description: 'Graph calendar and mail normalization.',
  },
  {
    key: 'google_workspace',
    title: 'Google Workspace',
    icon: <GoogleOutlined />,
    description: 'Gmail and Google Calendar normalization.',
  },
  {
    key: 'imap_caldav',
    title: 'IMAP / CalDAV',
    icon: <MailOutlined />,
    description: 'Fallback mail and calendar ingestion.',
  },
];

export function IntegrationsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [form] = Form.useForm<IntegrationFormValues>();

  const integrations = useQuery<IntegrationConnection[]>({
    queryKey: ['engagement-integrations'],
    queryFn: async () =>
      (await api.get<IntegrationConnection[]>('/api/engagement/integrations')).data,
  });

  const createIntegration = useMutation({
    mutationFn: async (values: IntegrationFormValues) =>
      (
        await api.post('/api/engagement/integrations', {
          provider: selectedProvider,
          accountEmail: values.accountEmail,
          displayName: values.displayName,
        })
      ).data,
    onSuccess: () => {
      message.success('Integration record created');
      setSelectedProvider(null);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['engagement-integrations'] });
    },
    onError: (err) => message.error(err instanceof Error ? err.message : 'Request failed'),
  });

  const startMicrosoftOAuth = useMutation({
    mutationFn: async (connectionId?: string) =>
      (
        await api.post<{ authUrl: string; connectionId: string }>(
          '/api/engagement/integrations/microsoft/start',
          connectionId ? { connectionId } : {},
        )
      ).data,
    onSuccess: ({ authUrl }) => {
      window.location.href = authUrl;
    },
    onError: (err) => message.error(err instanceof Error ? err.message : 'OAuth start failed'),
  });

  // Surface success / error from the Microsoft OAuth callback redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('provider') !== 'microsoft_365') return;
    if (params.get('connected') === '1') {
      message.success('Microsoft 365 connected');
      qc.invalidateQueries({ queryKey: ['engagement-integrations'] });
    } else if (params.get('error')) {
      message.error(`Microsoft OAuth failed: ${params.get('error')}`);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('provider');
    url.searchParams.delete('connected');
    url.searchParams.delete('connectionId');
    url.searchParams.delete('error');
    window.history.replaceState({}, '', url.toString());
  }, [message, qc]);

  return (
    <section className="settings-integrations">
      <div className="settings-integrations-header">
        <div>
          <Typography.Title level={5}>Engagement Integrations</Typography.Title>
          <Typography.Text type="secondary">
            Provider records, scopes, sync state, and connection health.
          </Typography.Text>
        </div>
        <Tag icon={<CloudSyncOutlined />} color="processing">
          normalized engagement store
        </Tag>
      </div>

      <div className="settings-integration-grid">
        {providers.map((provider) => {
          const connections = (integrations.data ?? []).filter(
            (connection) => connection.provider === provider.key,
          );
          return (
            <article className="settings-integration-card" key={provider.key}>
              <div className="settings-integration-top">
                <span className="settings-integration-icon">{provider.icon}</span>
                <div>
                  <Typography.Text strong>{provider.title}</Typography.Text>
                  <Typography.Text type="secondary">{provider.description}</Typography.Text>
                </div>
              </div>

              <div className="settings-integration-connections">
                {connections.length ? (
                  connections.map((connection) => (
                    <div className="settings-integration-row" key={connection.id}>
                      <div>
                        <Typography.Text>
                          {connection.displayName || connection.accountEmail || 'Workspace'}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          {connection.accountEmail || 'No account email'}
                        </Typography.Text>
                      </div>
                      <Tag color={statusColor(connection.status)}>{statusLabel(connection.status)}</Tag>
                    </div>
                  ))
                ) : (
                  <Typography.Text type="secondary">No accounts registered.</Typography.Text>
                )}
              </div>

              <Space wrap>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setSelectedProvider(provider.key);
                    form.resetFields();
                  }}
                >
                  Register account
                </Button>
                {provider.key === 'microsoft_365' ? (
                  <Button
                    icon={<ApiOutlined />}
                    type="primary"
                    loading={startMicrosoftOAuth.isPending}
                    onClick={() =>
                      startMicrosoftOAuth.mutate(
                        connections.find((c) => c.status !== 'connected')?.id,
                      )
                    }
                  >
                    Connect Microsoft 365
                  </Button>
                ) : (
                  <Button icon={<ApiOutlined />} disabled>
                    Connect OAuth
                  </Button>
                )}
              </Space>
            </article>
          );
        })}
      </div>

      <Modal
        title={
          selectedProvider
            ? `Register ${providers.find((provider) => provider.key === selectedProvider)?.title}`
            : 'Register integration'
        }
        open={Boolean(selectedProvider)}
        onCancel={() => setSelectedProvider(null)}
        onOk={() => form.submit()}
        confirmLoading={createIntegration.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(values) => createIntegration.mutate(values)}>
          <Form.Item name="displayName" label="Display name">
            <Input placeholder="Jane's Microsoft 365" />
          </Form.Item>
          <Form.Item name="accountEmail" label="Account email" rules={[{ type: 'email' }]}>
            <Input placeholder="jane@example.com" />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

function statusColor(status: IntegrationConnection['status']): string {
  if (status === 'connected') return 'green';
  if (status === 'error') return 'red';
  if (status === 'disabled') return 'default';
  return 'gold';
}

function statusLabel(status: IntegrationConnection['status']): string {
  return status.replace(/_/g, ' ');
}
