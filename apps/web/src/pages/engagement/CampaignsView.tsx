import { useState } from 'react';
import {
  DeleteOutlined,
  MailOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useApi } from '../../lib/use-api.js';
import type { Client } from '../clients/clientTypes.js';

const { Text, Title } = Typography;
const { TextArea } = Input;

type CampaignType = 'post_meeting_followup' | 'congressional_outreach' | 'program_update' | 'custom';
type CampaignStatus = 'draft' | 'active' | 'paused' | 'complete';
type RecipientStatus = 'pending' | 'sent' | 'opened' | 'bounced' | 'failed';

interface CampaignRecipient {
  id: string;
  name: string | null;
  email: string;
  title: string | null;
  office: string | null;
  status: RecipientStatus;
  sentAt: string | null;
}

interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  subject: string | null;
  body: string | null;
  clientId: string | null;
  sourceContext: Record<string, unknown>;
  metadata: Record<string, unknown>;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string } | null;
  createdBy: { id: string; email: string; firstName: string | null; lastName: string | null };
  recipients: CampaignRecipient[];
}

interface Meeting {
  id: string;
  subject: string;
  startsAt: string;
}

const CAMPAIGN_TYPES: Array<{ value: CampaignType; label: string }> = [
  { value: 'post_meeting_followup', label: 'Post-Meeting Follow-Up' },
  { value: 'congressional_outreach', label: 'Congressional Outreach' },
  { value: 'program_update', label: 'Program Update' },
  { value: 'custom', label: 'Custom' },
];

const CAMPAIGN_STATUSES: Array<{ value: CampaignStatus; label: string; color: string }> = [
  { value: 'draft', label: 'Draft', color: 'default' },
  { value: 'active', label: 'Active', color: 'processing' },
  { value: 'paused', label: 'Paused', color: 'warning' },
  { value: 'complete', label: 'Complete', color: 'success' },
];

function statusColor(status: CampaignStatus): string {
  return CAMPAIGN_STATUSES.find((s) => s.value === status)?.color ?? 'default';
}

function recipientStatusColor(status: RecipientStatus): string {
  const map: Record<RecipientStatus, string> = {
    pending: 'default',
    sent: 'processing',
    opened: 'success',
    bounced: 'warning',
    failed: 'error',
  };
  return map[status] ?? 'default';
}

interface Props {
  clients: Client[];
  selectedClientId: string | null;
  aiConfigured: boolean;
}

export function CampaignsView({ clients, selectedClientId, aiConfigured }: Props) {
  const { message } = App.useApp();
  const api = useApi();
  const queryClient = useQueryClient();

  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [filterClientId, setFilterClientId] = useState<string | null>(selectedClientId);
  const [filterStatus, setFilterStatus] = useState<CampaignStatus | null>(null);
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);
  const [addRecipientOpen, setAddRecipientOpen] = useState(false);
  const [pullMeetingOpen, setPullMeetingOpen] = useState(false);
  const [previewRecipient, setPreviewRecipient] = useState<CampaignRecipient | null>(null);

  const [newCampaignForm] = Form.useForm();
  const [addRecipientForm] = Form.useForm();

  const campaigns = useQuery({
    queryKey: ['campaigns', filterClientId, filterStatus],
    queryFn: async () =>
      (
        await api.get<Campaign[]>('/api/engagement/campaigns', {
          params: {
            ...(filterClientId ? { clientId: filterClientId } : {}),
            ...(filterStatus ? { status: filterStatus } : {}),
          },
        })
      ).data,
  });

  const selectedCampaign = useQuery({
    queryKey: ['campaign', selectedCampaignId],
    queryFn: async () =>
      (await api.get<Campaign>(`/api/engagement/campaigns/${selectedCampaignId!}`)).data,
    enabled: Boolean(selectedCampaignId),
  });

  const meetings = useQuery({
    queryKey: ['meetings-for-campaigns'],
    queryFn: async () =>
      (await api.get<Meeting[]>('/api/engagement/meetings')).data,
  });

  const createCampaign = useMutation({
    mutationFn: async (values: { name: string; clientId?: string; type: CampaignType }) =>
      (await api.post<Campaign>('/api/engagement/campaigns', values)).data,
    onSuccess: (campaign) => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setSelectedCampaignId(campaign.id);
      setNewCampaignOpen(false);
      newCampaignForm.resetFields();
      void message.success('Campaign created');
    },
    onError: () => void message.error('Failed to create campaign'),
  });

  const updateCampaign = useMutation({
    mutationFn: async (values: Partial<Campaign> & { id: string }) => {
      const { id, ...rest } = values;
      return (await api.patch<Campaign>(`/api/engagement/campaigns/${id}`, rest)).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      void queryClient.invalidateQueries({ queryKey: ['campaign', selectedCampaignId] });
    },
    onError: () => void message.error('Failed to update campaign'),
  });

  const deleteCampaign = useMutation({
    mutationFn: async (id: string) => api.delete(`/api/engagement/campaigns/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setSelectedCampaignId(null);
      void message.success('Campaign deleted');
    },
    onError: () => void message.error('Failed to delete campaign'),
  });

  const addRecipients = useMutation({
    mutationFn: async (values: { name?: string; email: string; title?: string; office?: string }) =>
      api.post(`/api/engagement/campaigns/${selectedCampaignId!}/recipients`, {
        recipients: [values],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', selectedCampaignId] });
      setAddRecipientOpen(false);
      addRecipientForm.resetFields();
      void message.success('Recipient added');
    },
    onError: () => void message.error('Failed to add recipient'),
  });

  const removeRecipient = useMutation({
    mutationFn: async (recipientId: string) =>
      api.delete(
        `/api/engagement/campaigns/${selectedCampaignId!}/recipients/${recipientId}`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', selectedCampaignId] });
      void message.success('Recipient removed');
    },
    onError: () => void message.error('Failed to remove recipient'),
  });

  const generateEmail = useMutation({
    mutationFn: async (customContext?: string) =>
      (
        await api.post<Campaign>(
          `/api/engagement/campaigns/${selectedCampaignId!}/generate`,
          { customContext },
        )
      ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', selectedCampaignId] });
      void message.success('Email content generated');
    },
    onError: () => void message.error('AI generation failed'),
  });

  const sendEmails = useMutation({
    mutationFn: async () =>
      (await api.post<{ ok: boolean; sent: number }>(
        `/api/engagement/campaigns/${selectedCampaignId!}/send`,
      )).data,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      void queryClient.invalidateQueries({ queryKey: ['campaign', selectedCampaignId] });
      void message.success(`Sent to ${data.sent} recipients`);
    },
    onError: () => void message.error('Failed to send campaign emails'),
  });

  const sendTest = useMutation({
    mutationFn: async () =>
      (await api.post<{ ok: boolean; sentTo: string }>(
        `/api/engagement/campaigns/${selectedCampaignId!}/send-test`,
      )).data,
    onSuccess: (data) => void message.success(`Test email sent to ${data.sentTo}`),
    onError: () => void message.error('Failed to send test email'),
  });

  const pullMeeting = useMutation({
    mutationFn: async (meetingId: string) => {
      const campaign = selectedCampaign.data!;
      const meeting = meetings.data?.find((m) => m.id === meetingId);
      return (
        await api.patch<Campaign>(`/api/engagement/campaigns/${selectedCampaignId!}`, {
          sourceContext: {
            ...(campaign.sourceContext ?? {}),
            meetingId,
          },
          name: campaign.name,
        })
      ).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', selectedCampaignId] });
      setPullMeetingOpen(false);
      void message.success('Meeting linked to campaign');
    },
    onError: () => void message.error('Failed to link meeting'),
  });

  const campaign = selectedCampaign.data;

  const recipientColumns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string | null, row: CampaignRecipient) => (
        <span>{name ?? <Text type="secondary">{row.email}</Text>}</span>
      ),
    },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      render: (v: string | null) => v ?? <Text type="secondary">-</Text>,
    },
    {
      title: 'Office',
      dataIndex: 'office',
      key: 'office',
      render: (v: string | null) => v ?? <Text type="secondary">-</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: RecipientStatus) => (
        <Tag color={recipientStatusColor(status)}>{status}</Tag>
      ),
    },
    {
      title: '',
      key: 'actions',
      render: (_: unknown, row: CampaignRecipient) => (
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => {
            Modal.confirm({
              title: 'Remove recipient?',
              content: row.email,
              okText: 'Remove',
              okButtonProps: { danger: true },
              onOk: () => removeRecipient.mutate(row.id),
            });
          }}
        />
      ),
    },
  ];

  const pendingCount = campaign?.recipients.filter((r) => r.status === 'pending').length ?? 0;
  const sentCount = campaign?.recipients.filter((r) => r.status === 'sent' || r.status === 'opened').length ?? 0;

  return (
    <div className="campaign-page">
      {/* Left: Campaign List */}
      <div className="campaign-list">
        <div className="campaign-list-head">
          <Title level={5} style={{ margin: 0 }}>
            <MailOutlined style={{ marginRight: 6 }} />
            Campaigns
          </Title>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setNewCampaignOpen(true)}
          >
            New Campaign
          </Button>
        </div>

        <div className="campaign-filters">
          <Select
            allowClear
            size="small"
            placeholder="Client"
            style={{ width: '100%' }}
            value={filterClientId ?? undefined}
            onChange={(v) => setFilterClientId(v ?? null)}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
          <Select
            allowClear
            size="small"
            placeholder="Status"
            style={{ width: '100%' }}
            value={filterStatus ?? undefined}
            onChange={(v) => setFilterStatus((v as CampaignStatus) ?? null)}
            options={CAMPAIGN_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
          />
        </div>

        {campaigns.isLoading ? (
          <Empty description="Loading campaigns..." />
        ) : !campaigns.data?.length ? (
          <Empty description="No campaigns yet. Create one to get started." />
        ) : (
          <div className="campaign-cards">
            {campaigns.data.map((c) => {
              const total = c.recipients.length;
              const sent = c.recipients.filter(
                (r) => r.status === 'sent' || r.status === 'opened',
              ).length;
              return (
                <div
                  key={c.id}
                  className={`campaign-card${selectedCampaignId === c.id ? ' campaign-card-selected' : ''}`}
                  onClick={() => setSelectedCampaignId(c.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedCampaignId(c.id)}
                >
                  <div className="campaign-card-header">
                    <span className="campaign-card-name">{c.name}</span>
                    <Tag color={statusColor(c.status)}>{c.status}</Tag>
                  </div>
                  {c.client && (
                    <div className="campaign-card-meta">
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {c.client.name}
                      </Text>
                    </div>
                  )}
                  <div className="campaign-card-stats">
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {total} recipients · {sent}/{total} sent
                    </Text>
                  </div>
                  <div className="campaign-card-meta">
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {CAMPAIGN_TYPES.find((t) => t.value === c.type)?.label ?? c.type}
                    </Text>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: Campaign Editor */}
      <div className="campaign-editor">
        {!campaign ? (
          <div className="campaign-empty-state">
            <Empty description="Select a campaign or create a new one" />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="campaign-header">
              <div className="campaign-header-row">
                <Input
                  value={campaign.name}
                  size="large"
                  style={{ fontWeight: 600, fontSize: 18, maxWidth: 400 }}
                  onBlur={(e) => {
                    if (e.target.value !== campaign.name && e.target.value.trim()) {
                      updateCampaign.mutate({ id: campaign.id, name: e.target.value.trim() });
                    }
                  }}
                  onChange={() => undefined}
                />
                <Tag color={statusColor(campaign.status)} style={{ marginLeft: 8 }}>
                  {campaign.status}
                </Tag>
                <Tooltip title="Delete campaign">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    style={{ marginLeft: 'auto' }}
                    onClick={() => {
                      Modal.confirm({
                        title: 'Delete this campaign?',
                        content: 'This action cannot be undone.',
                        okText: 'Delete',
                        okButtonProps: { danger: true },
                        onOk: () => deleteCampaign.mutate(campaign.id),
                      });
                    }}
                  />
                </Tooltip>
              </div>

              <div className="campaign-header-controls">
                <Select
                  size="small"
                  placeholder="Client"
                  style={{ width: 200 }}
                  value={campaign.clientId ?? undefined}
                  onChange={(v) =>
                    updateCampaign.mutate({ id: campaign.id, clientId: v ?? null })
                  }
                  allowClear
                  options={clients.map((c) => ({ value: c.id, label: c.name }))}
                />
                <Select
                  size="small"
                  value={campaign.type}
                  style={{ width: 200 }}
                  onChange={(v) =>
                    updateCampaign.mutate({ id: campaign.id, type: v as CampaignType })
                  }
                  options={CAMPAIGN_TYPES}
                />
                <Select
                  size="small"
                  value={campaign.status}
                  style={{ width: 140 }}
                  onChange={(v) =>
                    updateCampaign.mutate({ id: campaign.id, status: v as CampaignStatus })
                  }
                  options={CAMPAIGN_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
                />
              </div>
            </div>

            {/* Source Context */}
            <div className="campaign-context">
              <Title level={5} style={{ margin: '0 0 8px' }}>
                Source Context
              </Title>
              <Space wrap>
                <Button
                  size="small"
                  onClick={() => setPullMeetingOpen(true)}
                >
                  Pull from Meeting
                </Button>
                {Boolean((campaign.sourceContext as Record<string, unknown>).meetingId) && (
                  <Tag color="blue">
                    Meeting linked:{' '}
                    {meetings.data?.find(
                      (m) => m.id === (campaign.sourceContext as Record<string, unknown>).meetingId,
                    )?.subject ?? String((campaign.sourceContext as Record<string, unknown>).meetingId ?? '')}
                  </Tag>
                )}
              </Space>
              <TextArea
                rows={3}
                style={{ marginTop: 8 }}
                placeholder="Additional context for AI generation (optional)"
                defaultValue={
                  typeof (campaign.sourceContext as Record<string, unknown>).customContext === 'string'
                    ? String((campaign.sourceContext as Record<string, unknown>).customContext)
                    : ''
                }
                onBlur={(e) => {
                  updateCampaign.mutate({
                    id: campaign.id,
                    sourceContext: {
                      ...(campaign.sourceContext as Record<string, unknown>),
                      customContext: e.target.value,
                    },
                  });
                }}
              />
            </div>

            {/* Recipients */}
            <div className="campaign-recipients">
              <div className="campaign-section-head">
                <Title level={5} style={{ margin: 0 }}>
                  Recipients ({campaign.recipients.length})
                </Title>
                <Button
                  size="small"
                  icon={<UserAddOutlined />}
                  onClick={() => setAddRecipientOpen(true)}
                >
                  Add Recipient
                </Button>
              </div>
              <Table
                dataSource={campaign.recipients}
                columns={recipientColumns}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 8, size: 'small', hideOnSinglePage: true }}
                locale={{ emptyText: 'No recipients yet.' }}
              />
            </div>

            {/* Email Template */}
            <div className="campaign-email-editor">
              <div className="campaign-section-head">
                <Title level={5} style={{ margin: 0 }}>
                  Email Template
                </Title>
                {aiConfigured && (
                  <Button
                    size="small"
                    icon={<RobotOutlined />}
                    loading={generateEmail.isPending}
                    onClick={() => generateEmail.mutate(undefined)}
                  >
                    Generate with AI
                  </Button>
                )}
              </div>

              <div className="campaign-template-variables">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Variables:{' '}
                  {[
                    '{recipient_name}',
                    '{recipient_title}',
                    '{meeting_date}',
                    '{action_items}',
                  ].map((v) => (
                    <code key={v} style={{ marginRight: 6 }}>
                      {v}
                    </code>
                  ))}
                </Text>
              </div>

              <Input
                size="small"
                placeholder="Subject line"
                style={{ marginBottom: 8 }}
                value={campaign.subject ?? ''}
                onChange={() => undefined}
                onBlur={(e) => {
                  if (e.target.value !== campaign.subject) {
                    updateCampaign.mutate({ id: campaign.id, subject: e.target.value });
                  }
                }}
              />

              <TextArea
                rows={10}
                placeholder="Email body"
                value={campaign.body ?? ''}
                onChange={() => undefined}
                onBlur={(e) => {
                  if (e.target.value !== campaign.body) {
                    updateCampaign.mutate({ id: campaign.id, body: e.target.value });
                  }
                }}
              />

              {campaign.recipients.length > 0 && (
                <div className="campaign-preview-select">
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Preview for:{' '}
                  </Text>
                  <Select
                    allowClear
                    size="small"
                    placeholder="Select recipient to preview"
                    style={{ width: 260 }}
                    value={previewRecipient?.id}
                    onChange={(v) =>
                      setPreviewRecipient(campaign.recipients.find((r) => r.id === v) ?? null)
                    }
                    options={campaign.recipients.map((r) => ({
                      value: r.id,
                      label: r.name ?? r.email,
                    }))}
                  />
                  {previewRecipient && campaign.body && (
                    <div className="campaign-preview">
                      <Text strong style={{ display: 'block', marginBottom: 4 }}>
                        Preview, {previewRecipient.name ?? previewRecipient.email}
                      </Text>
                      <pre className="campaign-preview-body">
                        {campaign.body
                          .replace(/{recipient_name}/g, previewRecipient.name ?? '')
                          .replace(/{recipient_title}/g, previewRecipient.title ?? '')
                          .replace(/{recipient_office}/g, previewRecipient.office ?? '')}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Send Actions */}
            <div className="campaign-send-actions">
              <Space>
                <Button
                  size="small"
                  icon={<SendOutlined />}
                  loading={sendTest.isPending}
                  onClick={() => sendTest.mutate()}
                  disabled={!campaign.subject || !campaign.body}
                >
                  Send Test
                </Button>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={sendEmails.isPending}
                  onClick={() => {
                    Modal.confirm({
                      title: `Send to ${pendingCount} pending recipients?`,
                      content: `This will send the campaign email to ${pendingCount} recipients via your connected email.`,
                      okText: 'Send',
                      onOk: () => sendEmails.mutate(),
                    });
                  }}
                  disabled={!campaign.subject || !campaign.body || pendingCount === 0}
                >
                  Send All ({pendingCount})
                </Button>
              </Space>
              {sentCount > 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {sentCount} of {campaign.recipients.length} sent
                </Text>
              )}
            </div>
          </>
        )}
      </div>

      {/* New Campaign Modal */}
      <Modal
        title="New Campaign"
        open={newCampaignOpen}
        onCancel={() => setNewCampaignOpen(false)}
        onOk={() => newCampaignForm.submit()}
        confirmLoading={createCampaign.isPending}
        okText="Create"
      >
        <Form
          form={newCampaignForm}
          layout="vertical"
          initialValues={{ type: 'custom', clientId: selectedClientId ?? undefined }}
          onFinish={(values) => createCampaign.mutate(values)}
        >
          <Form.Item name="name" label="Campaign Name" rules={[{ required: true, message: 'Name required' }]}>
            <Input placeholder="e.g. Post-meeting follow-up, Smith office" />
          </Form.Item>
          <Form.Item name="clientId" label="Client">
            <Select
              allowClear
              placeholder="Select client"
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item name="type" label="Type">
            <Select options={CAMPAIGN_TYPES} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Add Recipient Modal */}
      <Modal
        title="Add Recipient"
        open={addRecipientOpen}
        onCancel={() => setAddRecipientOpen(false)}
        onOk={() => addRecipientForm.submit()}
        confirmLoading={addRecipients.isPending}
        okText="Add"
      >
        <Form
          form={addRecipientForm}
          layout="vertical"
          onFinish={(values) => addRecipients.mutate(values)}
        >
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Email required' },
              { type: 'email', message: 'Invalid email' },
            ]}
          >
            <Input placeholder="staffer@example.gov" />
          </Form.Item>
          <Form.Item name="name" label="Name">
            <Input placeholder="Jane Smith" />
          </Form.Item>
          <Form.Item name="title" label="Title">
            <Input placeholder="Legislative Director" />
          </Form.Item>
          <Form.Item name="office" label="Office">
            <Input placeholder="Office of Sen. Smith" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Pull from Meeting Modal */}
      <Modal
        title="Link Meeting"
        open={pullMeetingOpen}
        onCancel={() => setPullMeetingOpen(false)}
        footer={null}
      >
        {meetings.isLoading ? (
          <Empty description="Loading meetings..." />
        ) : !meetings.data?.length ? (
          <Empty description="No meetings found." />
        ) : (
          <div className="campaign-meeting-list">
            {meetings.data.map((m) => (
              <div
                key={m.id}
                className="campaign-meeting-row"
                role="button"
                tabIndex={0}
                onClick={() => pullMeeting.mutate(m.id)}
                onKeyDown={(e) => e.key === 'Enter' && pullMeeting.mutate(m.id)}
              >
                <Text strong>{m.subject}</Text>
                <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                  {new Date(m.startsAt).toLocaleDateString()}
                </Text>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
