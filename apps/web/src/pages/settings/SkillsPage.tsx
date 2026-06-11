import { useEffect, useState } from 'react';
import {
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  HistoryOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useApi } from '../../lib/use-api.js';

/**
 * Settings → Skills (assistant-parity F6b): firm-authored Clio skills.
 *
 * Admin-gated authoring UI over /api/clio/firm-skills. Client-side rules
 * mirror the server validator (clio-firm-skills.helpers.ts); the API stays
 * the security boundary.
 */

// Mirrors of the server-side LIMITS in clio-firm-skills.helpers.ts.
const SKILL_LIMITS = {
  idPattern: /^[a-z0-9_]{2,48}$/,
  name: 80,
  addendum: 2000,
  triggers: 5,
  tools: 12,
  sections: 12,
  sectionLen: 80,
  heading: 120,
};

interface ClioSkillDef {
  id: string;
  name: string;
  triggers: string[];
  systemAddendum: string;
  requiredTools: string[];
  template: { heading: string; sections: string[] } | null;
}

interface FirmSkillRow {
  id: string;
  skillId: string;
  name: string;
  skill: ClioSkillDef;
  version: number;
  versions: Array<{ version: number; savedAt: string }>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ToolManifestResponse {
  tools: Array<{ name: string; description: string }>;
}

interface SkillTestResponse {
  skillId: string;
  triggers: string[];
  systemAddendum: string;
  template: { heading: string; sections: string[] } | null;
  requiredTools: string[];
  note: string;
}

interface SkillFormValues {
  id: string;
  name: string;
  triggers: string[];
  systemAddendum: string;
  requiredTools?: string[];
  templateHeading?: string;
  templateSections?: string[];
}

export function SkillsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<SkillFormValues>();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<FirmSkillRow | null>(null);
  const [historyRow, setHistoryRow] = useState<FirmSkillRow | null>(null);
  const [testResult, setTestResult] = useState<{ name: string; result: SkillTestResponse } | null>(
    null,
  );

  const skills = useQuery<FirmSkillRow[]>({
    queryKey: ['clio-firm-skills'],
    queryFn: async () => (await api.get<FirmSkillRow[]>('/api/clio/firm-skills')).data,
  });

  const toolManifest = useQuery<ToolManifestResponse>({
    queryKey: ['clio-tools'],
    queryFn: async () => (await api.get<ToolManifestResponse>('/api/clio/tools')).data,
    staleTime: 5 * 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['clio-firm-skills'] });

  const save = useMutation({
    mutationFn: async (payload: { rowId: string | null; body: Record<string, unknown> }) =>
      payload.rowId
        ? (await api.patch(`/api/clio/firm-skills/${payload.rowId}`, payload.body)).data
        : (await api.post('/api/clio/firm-skills', payload.body)).data,
    onSuccess: (_data, payload) => {
      message.success(payload.rowId ? 'Skill updated' : 'Skill created');
      setEditorOpen(false);
      setEditingRow(null);
      invalidate();
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const setEnabled = useMutation({
    mutationFn: async (payload: { rowId: string; enabled: boolean }) =>
      (
        await api.patch(`/api/clio/firm-skills/${payload.rowId}/enabled`, {
          enabled: payload.enabled,
        })
      ).data,
    onSuccess: (_data, payload) => {
      message.success(payload.enabled ? 'Skill enabled' : 'Skill disabled');
      invalidate();
    },
    onError: (err) => {
      message.error(errorMessage(err));
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: async (rowId: string) => (await api.delete(`/api/clio/firm-skills/${rowId}`)).data,
    onSuccess: () => {
      message.success('Skill deleted');
      invalidate();
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const restore = useMutation({
    mutationFn: async (payload: { rowId: string; version: number }) =>
      (
        await api.post(`/api/clio/firm-skills/${payload.rowId}/restore`, {
          version: payload.version,
        })
      ).data,
    onSuccess: (_data, payload) => {
      message.success(`Restored version ${payload.version}`);
      setHistoryRow(null);
      invalidate();
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const test = useMutation({
    mutationFn: async (row: FirmSkillRow) =>
      (await api.post<SkillTestResponse>(`/api/clio/firm-skills/${row.id}/test`)).data,
    onSuccess: (data, row) => setTestResult({ name: row.name, result: data }),
    onError: (err) => message.error(errorMessage(err)),
  });

  // Seed the editor form whenever the modal opens (forceRender on the Modal
  // keeps the Form mounted so setFieldsValue lands).
  useEffect(() => {
    if (!editorOpen) return;
    if (editingRow) {
      form.setFieldsValue({
        id: editingRow.skill.id,
        name: editingRow.skill.name,
        triggers: editingRow.skill.triggers,
        systemAddendum: editingRow.skill.systemAddendum,
        requiredTools: editingRow.skill.requiredTools,
        templateHeading: editingRow.skill.template?.heading ?? '',
        templateSections: editingRow.skill.template?.sections ?? [],
      });
    } else {
      form.resetFields();
    }
  }, [editorOpen, editingRow, form]);

  const openCreate = () => {
    setEditingRow(null);
    setEditorOpen(true);
  };

  const openEdit = (row: FirmSkillRow) => {
    setEditingRow(row);
    setEditorOpen(true);
  };

  const submitEditor = (values: SkillFormValues) => {
    const heading = values.templateHeading?.trim() ?? '';
    const sections = (values.templateSections ?? []).map((s) => s.trim()).filter(Boolean);
    const body = {
      id: values.id.trim(),
      name: values.name.trim(),
      triggers: values.triggers.map((t) => t.trim()).filter(Boolean),
      systemAddendum: values.systemAddendum.trim(),
      requiredTools: values.requiredTools ?? [],
      template: heading && sections.length > 0 ? { heading, sections } : null,
    };
    save.mutate({ rowId: editingRow?.id ?? null, body });
  };

  const toolOptions = (toolManifest.data?.tools ?? []).map((tool) => ({
    value: tool.name,
    label: tool.name,
    title: tool.description,
  }));

  const columns = [
    {
      title: 'Skill',
      key: 'name',
      render: (_: unknown, row: FirmSkillRow) => (
        <div>
          <Typography.Text strong>{row.name}</Typography.Text>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} code>
              {row.skillId}
            </Typography.Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Triggers',
      key: 'triggers',
      render: (_: unknown, row: FirmSkillRow) => (
        <>
          {row.skill.triggers.map((trigger) => (
            <Tag key={trigger}>{trigger}</Tag>
          ))}
        </>
      ),
    },
    {
      title: 'Version',
      dataIndex: 'version',
      key: 'version',
      width: 90,
      render: (version: number) => <Typography.Text type="secondary">v{version}</Typography.Text>,
    },
    {
      title: 'Enabled',
      key: 'enabled',
      width: 90,
      render: (_: unknown, row: FirmSkillRow) => (
        <Switch
          size="small"
          checked={row.enabled}
          loading={setEnabled.isPending && setEnabled.variables?.rowId === row.id}
          onChange={(checked) => setEnabled.mutate({ rowId: row.id, enabled: checked })}
          aria-label={`${row.enabled ? 'Disable' : 'Enable'} ${row.name}`}
        />
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_: unknown, row: FirmSkillRow) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            Edit
          </Button>
          <Button
            size="small"
            icon={<ExperimentOutlined />}
            loading={test.isPending && test.variables?.id === row.id}
            onClick={() => test.mutate(row)}
            title="Dry-run: shows what this skill injects"
          >
            Test
          </Button>
          <Button
            size="small"
            icon={<HistoryOutlined />}
            onClick={() => setHistoryRow(row)}
            disabled={!row.versions.length}
            title="Version history"
            aria-label={`Version history for ${row.name}`}
          />
          <Button
            size="small"
            icon={<DeleteOutlined />}
            danger
            aria-label={`Delete ${row.name}`}
            onClick={() => {
              modal.confirm({
                title: `Delete "${row.name}"?`,
                content: 'Clio stops applying this skill immediately. This cannot be undone.',
                okText: 'Delete',
                okButtonProps: { danger: true },
                onOk: () => remove.mutateAsync(row.id),
              });
            }}
          />
        </Space>
      ),
    },
  ];

  return (
    <section className="settings-skills">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div>
          <Typography.Title level={5} style={{ marginBottom: 4 }}>
            Clio Skills
          </Typography.Title>
          <Typography.Text type="secondary">
            Firm-authored playbooks Clio applies when a trigger phrase fires: extra guidance,
            required tools, and an optional response template. Built-in skills always win on
            conflicting triggers.
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          New skill
        </Button>
      </div>

      <Table<FirmSkillRow>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={skills.data ?? []}
        loading={skills.isLoading}
        pagination={false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No firm skills yet. Create one to teach Clio your house playbooks."
            />
          ),
        }}
      />

      <Modal
        title={editingRow ? `Edit skill: ${editingRow.name}` : 'New skill'}
        open={editorOpen}
        onCancel={() => {
          setEditorOpen(false);
          setEditingRow(null);
        }}
        onOk={() => form.submit()}
        okText={editingRow ? 'Save' : 'Create'}
        confirmLoading={save.isPending}
        forceRender
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={submitEditor}>
          <Form.Item
            name="id"
            label="Skill ID"
            tooltip="Stable identifier; 2-48 chars of lowercase letters, digits, underscore."
            rules={[
              { required: true, message: 'Skill ID is required' },
              {
                pattern: SKILL_LIMITS.idPattern,
                message: 'Use 2-48 chars: lowercase letters, digits, underscore',
              },
            ]}
          >
            <Input placeholder="earmark_request_memo" disabled={Boolean(editingRow)} />
          </Form.Item>
          <Form.Item
            name="name"
            label="Name"
            rules={[
              { required: true, message: 'Name is required' },
              { max: SKILL_LIMITS.name, message: `Max ${SKILL_LIMITS.name} characters` },
            ]}
          >
            <Input placeholder="Earmark request memo" maxLength={SKILL_LIMITS.name} />
          </Form.Item>
          <Form.Item
            name="triggers"
            label="Trigger phrases"
            tooltip="Clio applies the skill when the user's message contains one of these."
            rules={[
              {
                validator: (_rule, value: string[] | undefined) => {
                  const count = (value ?? []).filter((t) => t.trim()).length;
                  if (count < 1 || count > SKILL_LIMITS.triggers) {
                    return Promise.reject(
                      new Error(`Add 1-${SKILL_LIMITS.triggers} trigger phrases`),
                    );
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Select
              mode="tags"
              placeholder="Type a phrase and press Enter"
              tokenSeparators={[',']}
              open={false}
            />
          </Form.Item>
          <Form.Item
            name="systemAddendum"
            label="System guidance"
            tooltip="Injected into Clio's system prompt when the skill fires."
            rules={[
              { required: true, message: 'Guidance is required' },
              { max: SKILL_LIMITS.addendum, message: `Max ${SKILL_LIMITS.addendum} characters` },
            ]}
          >
            <Input.TextArea
              rows={5}
              maxLength={SKILL_LIMITS.addendum}
              showCount
              placeholder="When drafting an earmark request memo, always confirm the appropriations subcommittee…"
            />
          </Form.Item>
          <Form.Item
            name="requiredTools"
            label="Required tools"
            tooltip="Tools Clio must run before answering (optional)."
            rules={[
              {
                validator: (_rule, value: string[] | undefined) =>
                  (value ?? []).length > SKILL_LIMITS.tools
                    ? Promise.reject(new Error(`Max ${SKILL_LIMITS.tools} tools`))
                    : Promise.resolve(),
              },
            ]}
          >
            <Select
              mode="multiple"
              placeholder="Select tools"
              options={toolOptions}
              loading={toolManifest.isLoading}
              optionFilterProp="value"
            />
          </Form.Item>
          <Form.Item
            name="templateHeading"
            label="Response template heading (optional)"
            tooltip="With at least one section, structures Clio's answer. Leave blank for none."
          >
            <Input placeholder="Earmark Request Memo" maxLength={SKILL_LIMITS.heading} />
          </Form.Item>
          <Form.Item
            name="templateSections"
            label="Template sections"
            rules={[
              {
                validator: (_rule, value: string[] | undefined) =>
                  (value ?? []).length > SKILL_LIMITS.sections
                    ? Promise.reject(new Error(`Max ${SKILL_LIMITS.sections} sections`))
                    : Promise.resolve(),
              },
            ]}
          >
            <Select
              mode="tags"
              placeholder="Type a section name and press Enter"
              tokenSeparators={[',']}
              open={false}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={testResult ? `Test: ${testResult.name}` : 'Test skill'}
        open={Boolean(testResult)}
        onCancel={() => setTestResult(null)}
        footer={
          <Button type="primary" onClick={() => setTestResult(null)}>
            Close
          </Button>
        }
        width={640}
      >
        {testResult ? (
          <div>
            <Typography.Paragraph type="secondary">{testResult.result.note}</Typography.Paragraph>
            <Typography.Text strong>Triggers</Typography.Text>
            <div style={{ margin: '4px 0 12px' }}>
              {testResult.result.triggers.map((trigger) => (
                <Tag key={trigger}>{trigger}</Tag>
              ))}
            </div>
            <Typography.Text strong>System guidance</Typography.Text>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                background: 'var(--bg-sunken, #f5f5f4)',
                borderRadius: 6,
                padding: 12,
                fontSize: 12,
                margin: '4px 0 12px',
              }}
            >
              {testResult.result.systemAddendum}
            </pre>
            {testResult.result.template ? (
              <>
                <Typography.Text strong>Response template</Typography.Text>
                <div style={{ margin: '4px 0 12px' }}>
                  <Typography.Text>{testResult.result.template.heading}</Typography.Text>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                    {testResult.result.template.sections.map((section) => (
                      <li key={section}>{section}</li>
                    ))}
                  </ul>
                </div>
              </>
            ) : null}
            {testResult.result.requiredTools.length ? (
              <>
                <Typography.Text strong>Required tools</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  {testResult.result.requiredTools.map((tool) => (
                    <Tag key={tool}>{tool}</Tag>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Drawer
        title={historyRow ? `Version history: ${historyRow.name}` : 'Version history'}
        open={Boolean(historyRow)}
        onClose={() => setHistoryRow(null)}
        width={420}
      >
        {historyRow ? (
          <div>
            <Typography.Paragraph type="secondary">
              Current version: v{historyRow.version}. Restoring re-validates the snapshot and saves
              it as a new version.
            </Typography.Paragraph>
            {historyRow.versions.length ? (
              historyRow.versions.map((entry) => (
                <div
                  key={entry.version}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '8px 0',
                    borderBottom: '1px solid rgba(0,0,0,0.06)',
                  }}
                >
                  <div>
                    <Typography.Text strong>v{entry.version}</Typography.Text>
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        Saved {formatDateTime(entry.savedAt)}
                      </Typography.Text>
                    </div>
                  </div>
                  <Button
                    size="small"
                    loading={restore.isPending && restore.variables?.version === entry.version}
                    onClick={() => restore.mutate({ rowId: historyRow.id, version: entry.version })}
                  >
                    Restore
                  </Button>
                </div>
              ))
            ) : (
              <Typography.Text type="secondary">No previous versions.</Typography.Text>
            )}
          </div>
        ) : null}
      </Drawer>
    </section>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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
