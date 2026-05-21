import { useState } from 'react';
import {
  App,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import { LockOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useApi } from '../../../../lib/use-api.js';

interface AiTemplate {
  id: string;
  source: 'system' | 'user';
  name: string;
  category: string;
  prompt: string;
  description: string | null;
  samplePreview: string | null;
  tone: string;
  usageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

interface PreviewData {
  subject: string;
  body: string;
  templateName: string;
}

interface TemplateSelectProps {
  selectedTemplateId: string | null;
  additionalContext: string;
  onChange: (patch: { selectedTemplateId?: string | null; additionalContext?: string }) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  general: 'default',
  follow_up: 'blue',
  meeting: 'cyan',
  policy: 'purple',
  custom: 'orange',
};

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'formal', label: 'Formal' },
  { value: 'concise', label: 'Concise' },
];

export function TemplateSelect({ selectedTemplateId, additionalContext, onChange }: TemplateSelectProps) {
  const api = useApi();
  const { message } = App.useApp();
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm<{
    name: string;
    category: string;
    prompt: string;
    description: string;
    tone: string;
  }>();

  const templates = useQuery<AiTemplate[]>({
    queryKey: ['outreach-ai-templates'],
    queryFn: async () =>
      (await api.get<AiTemplate[]>('/api/engagement/outreach/ai-templates')).data,
  });

  const createTemplate = useMutation({
    mutationFn: async (values: {
      name: string;
      category: string;
      prompt: string;
      description: string;
      tone: string;
    }) =>
      (
        await api.post<AiTemplate>('/api/engagement/outreach/ai-templates', {
          name: values.name,
          category: values.category || 'custom',
          prompt: values.prompt,
          description: values.description || undefined,
          tone: values.tone || 'professional',
        })
      ).data,
    onSuccess: (template) => {
      message.success('Template created');
      setCreateModalOpen(false);
      createForm.resetFields();
      templates.refetch().catch(() => {});
      onChange({ selectedTemplateId: template.id });
    },
    onError: (err: unknown) => message.error(extractMessage(err)),
  });

  const openPreview = async (templateId: string) => {
    setPreviewTemplateId(templateId);
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      const result = await api.get<PreviewData>(
        `/api/engagement/outreach/ai-templates/${templateId}/preview`,
      );
      setPreviewData(result.data);
    } catch {
      setPreviewData({ subject: 'Preview unavailable', body: 'Could not generate preview.', templateName: '' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewTemplateId(null);
    setPreviewData(null);
  };

  const templateList = templates.data ?? [];

  return (
    <div className="outreach-flow-stack">
      <Typography.Title level={4}>Select a template</Typography.Title>
      <Typography.Paragraph type="secondary">
        Choose the type of email Clio should write. System templates are pre-configured; you can
        also create your own.
      </Typography.Paragraph>

      {templates.isLoading ? (
        <Row gutter={[16, 16]}>
          {[1, 2, 3, 4].map((i) => (
            <Col key={i} xs={24} sm={12} lg={8}>
              <Card size="small">
                <Skeleton active paragraph={{ rows: 2 }} />
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
        <Row gutter={[16, 16]}>
          {templateList.map((tmpl) => {
            const isSelected = selectedTemplateId === tmpl.id;
            return (
              <Col key={tmpl.id} xs={24} sm={12} lg={8}>
                <Card
                  size="small"
                  hoverable
                  style={{
                    cursor: 'pointer',
                    borderColor: isSelected ? '#1c2e4a' : undefined,
                    background: isSelected ? '#1c2e4a0a' : undefined,
                  }}
                  onClick={() => onChange({ selectedTemplateId: tmpl.id })}
                  extra={
                    tmpl.source === 'system' ? (
                      <LockOutlined style={{ color: '#aaa', fontSize: 12 }} />
                    ) : null
                  }
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{tmpl.name}</div>
                    <Badge count={tmpl.usageCount} overflowCount={999} style={{ backgroundColor: '#6b7280' }} />
                  </div>

                  <div style={{ marginBottom: 6 }}>
                    <Tag color={CATEGORY_COLORS[tmpl.category] ?? 'default'} style={{ fontSize: 11 }}>
                      {tmpl.category}
                    </Tag>
                    <Tag style={{ fontSize: 11 }}>{tmpl.tone}</Tag>
                  </div>

                  {tmpl.description && (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                      {tmpl.description}
                    </Typography.Text>
                  )}

                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 11, display: 'block', fontStyle: 'italic' }}
                  >
                    {tmpl.prompt.slice(0, 90)}
                    {tmpl.prompt.length > 90 ? '…' : ''}
                  </Typography.Text>

                  <div style={{ marginTop: 8 }}>
                    <Button
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        void openPreview(tmpl.id);
                      }}
                    >
                      Preview
                    </Button>
                  </div>
                </Card>
              </Col>
            );
          })}

          <Col xs={24} sm={12} lg={8}>
            <Card
              size="small"
              hoverable
              style={{ cursor: 'pointer', borderStyle: 'dashed', height: '100%', minHeight: 120 }}
              onClick={() => setCreateModalOpen(true)}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  minHeight: 100,
                  gap: 8,
                  color: '#888',
                }}
              >
                <PlusOutlined style={{ fontSize: 24 }} />
                <Typography.Text type="secondary">Create custom template</Typography.Text>
              </div>
            </Card>
          </Col>
        </Row>
      )}

      <div style={{ marginTop: 16 }}>
        <Typography.Text strong>Additional context</Typography.Text>
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          Any extra instructions Clio should follow when writing these emails. Specific angles,
          things to avoid, key messages, etc.
        </Typography.Text>
        <Input.TextArea
          rows={3}
          value={additionalContext}
          placeholder="E.g. Emphasize the defense applications. Do not mention any specific dollar amounts. Keep under 200 words."
          onChange={(e) => onChange({ additionalContext: e.target.value })}
        />
      </div>

      <Modal
        title="Preview template"
        open={previewTemplateId !== null}
        onCancel={closePreview}
        footer={
          <Button type="primary" onClick={closePreview}>
            Close
          </Button>
        }
        width={640}
      >
        {previewLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : previewData ? (
          <div>
            <div style={{ marginBottom: 8 }}>
              <Typography.Text strong>Subject: </Typography.Text>
              <Typography.Text>{previewData.subject}</Typography.Text>
            </div>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                fontSize: 13,
                background: '#f8f9fa',
                padding: 12,
                borderRadius: 4,
                maxHeight: 400,
                overflow: 'auto',
              }}
            >
              {previewData.body}
            </pre>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              This preview uses a mock recipient. Actual emails will be personalized.
            </Typography.Text>
          </div>
        ) : null}
      </Modal>

      <Modal
        title="Create custom template"
        open={createModalOpen}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
        }}
        footer={null}
        width={560}
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ category: 'custom', tone: 'professional' }}
          onFinish={(values) => void createTemplate.mutateAsync(values)}
        >
          <Form.Item label="Template name" name="name" rules={[{ required: true }]}>
            <Input maxLength={120} placeholder="E.g. Healthcare intro email" />
          </Form.Item>
          <Form.Item label="Category" name="category">
            <Select
              options={[
                { value: 'general', label: 'General' },
                { value: 'follow_up', label: 'Follow-up' },
                { value: 'meeting', label: 'Meeting' },
                { value: 'policy', label: 'Policy' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          </Form.Item>
          <Form.Item label="Default tone" name="tone">
            <Select options={TONE_OPTIONS} />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input placeholder="One-line description (optional)" maxLength={500} />
          </Form.Item>
          <Form.Item
            label="Prompt instructions"
            name="prompt"
            rules={[{ required: true }]}
            extra="Write instructions for Clio as if you're briefing a colleague. E.g. 'Write a concise introduction email on behalf of the client…'"
          >
            <Input.TextArea rows={5} placeholder="Write a concise introduction email on behalf of the client…" />
          </Form.Item>
          <Space>
            <Button onClick={() => setCreateModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={createTemplate.isPending}>
              Save template
            </Button>
          </Space>
        </Form>
      </Modal>
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
