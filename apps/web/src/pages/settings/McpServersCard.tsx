import { useEffect, useState } from 'react';
import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SyncOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ROLE_RANK } from '@capiro/shared';
import { useMe } from '../../lib/me.js';
import { useApi } from '../../lib/use-api.js';

/**
 * Settings → Integrations → "Clio MCP Servers" (assistant-parity F6a).
 *
 * Admin CRUD over /api/clio/mcp-servers. The bearer token is write-only:
 * the API never returns it (only hasAuthToken); leaving the field blank on
 * edit keeps the stored token, the explicit clear checkbox sends
 * `authToken: null`.
 */

interface McpServerRow {
  id: string;
  name: string;
  transport: 'http' | 'stdio';
  endpoint: string | null;
  command: string | null;
  args: string[] | null;
  toolAllowlist: string[] | null;
  readOnlyTools: string[] | null;
  enabled: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  hasAuthToken: boolean;
  createdAt: string;
  updatedAt: string;
}

interface McpFormValues {
  name: string;
  transport: 'http' | 'stdio';
  endpoint?: string;
  command?: string;
  args?: string[];
  authToken?: string;
  clearAuthToken?: boolean;
  toolAllowlist?: string[];
  readOnlyTools?: string[];
}

export function McpServersCard() {
  const api = useApi();
  const qc = useQueryClient();
  const me = useMe();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<McpFormValues>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<McpServerRow | null>(null);
  const transport = Form.useWatch('transport', form);

  const isAdmin = Boolean(me.data && ROLE_RANK[me.data.role] >= ROLE_RANK.user_admin);

  const servers = useQuery<McpServerRow[]>({
    queryKey: ['clio-mcp-servers'],
    queryFn: async () => (await api.get<McpServerRow[]>('/api/clio/mcp-servers')).data,
    enabled: isAdmin,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['clio-mcp-servers'] });

  const save = useMutation({
    mutationFn: async (payload: { rowId: string | null; body: Record<string, unknown> }) =>
      payload.rowId
        ? (await api.patch(`/api/clio/mcp-servers/${payload.rowId}`, payload.body)).data
        : (await api.post('/api/clio/mcp-servers', payload.body)).data,
    onSuccess: (_data, payload) => {
      message.success(payload.rowId ? 'MCP server updated' : 'MCP server added');
      setEditorOpen(false);
      setEditingRow(null);
      invalidate();
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const setEnabled = useMutation({
    mutationFn: async (payload: { rowId: string; enabled: boolean }) =>
      (await api.patch(`/api/clio/mcp-servers/${payload.rowId}`, { enabled: payload.enabled }))
        .data,
    onSuccess: (_data, payload) => {
      message.success(payload.enabled ? 'Server enabled' : 'Server disabled');
      invalidate();
    },
    onError: (err) => {
      message.error(errorMessage(err));
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: async (rowId: string) => (await api.delete(`/api/clio/mcp-servers/${rowId}`)).data,
    onSuccess: () => {
      message.success('MCP server removed');
      invalidate();
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  const refresh = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ tools: string[]; refreshedAt: string }>(
          '/api/clio/mcp-servers/refresh',
          {},
          // Refresh contacts every enabled server inline; allow extra headroom.
          { timeout: 60_000 },
        )
      ).data,
    onSuccess: (data) => {
      invalidate();
      modal.info({
        title: 'Bridged MCP tools',
        content: data.tools.length ? (
          <div>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              {data.tools.length} tool{data.tools.length === 1 ? '' : 's'} available to Clio
              (refreshed {formatDateTime(data.refreshedAt)}).
            </Typography.Paragraph>
            <div>
              {data.tools.map((tool) => (
                <Tag key={tool} style={{ marginBottom: 4 }}>
                  {tool}
                </Tag>
              ))}
            </div>
          </div>
        ) : (
          'No tools registered. Check each server’s allowlist and last error.'
        ),
      });
    },
    onError: (err) => message.error(errorMessage(err)),
  });

  // Seed the editor form whenever the modal opens (forceRender keeps the
  // Form mounted so setFieldsValue lands).
  useEffect(() => {
    if (!editorOpen) return;
    if (editingRow) {
      form.setFieldsValue({
        name: editingRow.name,
        transport: editingRow.transport,
        endpoint: editingRow.endpoint ?? '',
        command: editingRow.command ?? '',
        args: editingRow.args ?? [],
        authToken: '',
        clearAuthToken: false,
        toolAllowlist: editingRow.toolAllowlist ?? [],
        readOnlyTools: editingRow.readOnlyTools ?? [],
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ transport: 'http' });
    }
  }, [editorOpen, editingRow, form]);

  const submitEditor = (values: McpFormValues) => {
    const body: Record<string, unknown> = {
      name: values.name.trim(),
      transport: values.transport,
      toolAllowlist: values.toolAllowlist ?? [],
      readOnlyTools: values.readOnlyTools ?? [],
    };
    if (values.transport === 'http') {
      body.endpoint = values.endpoint?.trim();
    } else {
      body.command = values.command?.trim();
      body.args = values.args ?? [];
    }
    const token = values.authToken?.trim();
    if (token) {
      body.authToken = token;
    } else if (editingRow && values.clearAuthToken) {
      // Explicit clear; a blank field otherwise keeps the stored token.
      body.authToken = null;
    }
    save.mutate({ rowId: editingRow?.id ?? null, body });
  };

  if (!isAdmin) return null;

  const columns = [
    {
      title: 'Server',
      key: 'name',
      render: (_: unknown, row: McpServerRow) => (
        <div>
          <Typography.Text strong>{row.name}</Typography.Text>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.transport === 'http'
                ? row.endpoint || 'No endpoint'
                : [row.command, ...(row.args ?? [])].filter(Boolean).join(' ') || 'No command'}
            </Typography.Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Transport',
      dataIndex: 'transport',
      key: 'transport',
      width: 100,
      render: (value: McpServerRow['transport']) => (
        <Tag color={value === 'http' ? 'blue' : 'purple'}>{value}</Tag>
      ),
    },
    {
      title: 'Tools',
      key: 'tools',
      width: 110,
      render: (_: unknown, row: McpServerRow) => {
        const allowed = row.toolAllowlist?.length ?? 0;
        return (
          <Tooltip
            title={
              allowed
                ? (row.toolAllowlist ?? []).join(', ')
                : 'Empty allowlist — no tools register (fail-closed).'
            }
          >
            <Tag color={allowed ? 'default' : 'orange'}>{allowed} allowed</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Enabled',
      key: 'enabled',
      width: 90,
      render: (_: unknown, row: McpServerRow) => (
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
      title: 'Last sync',
      key: 'lastSync',
      width: 170,
      render: (_: unknown, row: McpServerRow) => (
        <Space size={6}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.lastSyncAt ? formatDateTime(row.lastSyncAt) : 'Never'}
          </Typography.Text>
          {row.lastError ? (
            <Tooltip title={row.lastError}>
              <WarningOutlined style={{ color: '#cf1322' }} aria-label="Last sync error" />
            </Tooltip>
          ) : null}
        </Space>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      render: (_: unknown, row: McpServerRow) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            aria-label={`Edit ${row.name}`}
            onClick={() => {
              setEditingRow(row);
              setEditorOpen(true);
            }}
          />
          <Button
            size="small"
            icon={<DeleteOutlined />}
            danger
            aria-label={`Remove ${row.name}`}
            onClick={() => {
              modal.confirm({
                title: `Remove "${row.name}"?`,
                content: 'Clio loses access to this server’s tools immediately.',
                okText: 'Remove',
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
    <article className="settings-integration-card" style={{ marginTop: 24 }}>
      <div className="settings-integration-top">
        <span className="settings-integration-icon">
          <ApiOutlined />
        </span>
        <div>
          <Typography.Text strong>Clio MCP Servers</Typography.Text>
          <Typography.Text type="secondary">
            Bridge external Model Context Protocol tools into Clio. Only allowlisted tools register;
            bridged calls are audit-logged.
          </Typography.Text>
        </div>
      </div>

      <Table<McpServerRow>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={servers.data ?? []}
        loading={servers.isLoading}
        pagination={false}
        locale={{ emptyText: 'No MCP servers configured.' }}
      />

      <Space wrap>
        <Button
          icon={<PlusOutlined />}
          onClick={() => {
            setEditingRow(null);
            setEditorOpen(true);
          }}
        >
          Add MCP server
        </Button>
        <Button
          icon={<SyncOutlined />}
          loading={refresh.isPending}
          disabled={!(servers.data ?? []).some((row) => row.enabled)}
          onClick={() => refresh.mutate()}
        >
          Refresh tools now
        </Button>
      </Space>

      <Modal
        title={editingRow ? `Edit MCP server: ${editingRow.name}` : 'Add MCP server'}
        open={editorOpen}
        onCancel={() => {
          setEditorOpen(false);
          setEditingRow(null);
        }}
        onOk={() => form.submit()}
        okText={editingRow ? 'Save' : 'Add'}
        confirmLoading={save.isPending}
        forceRender
        width={560}
      >
        <Form form={form} layout="vertical" onFinish={submitEditor}>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input placeholder="Firm research tools" maxLength={80} />
          </Form.Item>
          <Form.Item
            name="transport"
            label="Transport"
            rules={[{ required: true, message: 'Transport is required' }]}
            extra={
              transport === 'stdio'
                ? 'stdio servers require platform-operator allowlisting before they can run.'
                : undefined
            }
          >
            <Select
              options={[
                { value: 'http', label: 'HTTP (streamable)' },
                { value: 'stdio', label: 'stdio (local process)' },
              ]}
            />
          </Form.Item>
          {transport === 'stdio' ? (
            <>
              <Form.Item
                name="command"
                label="Command"
                rules={[{ required: true, message: 'Command is required for stdio servers' }]}
              >
                <Input placeholder="npx" />
              </Form.Item>
              <Form.Item name="args" label="Arguments">
                <Select mode="tags" placeholder="Type an argument and press Enter" open={false} />
              </Form.Item>
            </>
          ) : (
            <Form.Item
              name="endpoint"
              label="Endpoint"
              rules={[
                { required: true, message: 'Endpoint is required for HTTP servers' },
                {
                  validator: (_rule, value: string | undefined) =>
                    !value || /^https:\/\//i.test(value.trim())
                      ? Promise.resolve()
                      : Promise.reject(new Error('Endpoint must use https://')),
                },
              ]}
            >
              <Input placeholder="https://mcp.example.com/mcp" />
            </Form.Item>
          )}
          <Form.Item
            name="authToken"
            label="Bearer token"
            extra={
              editingRow?.hasAuthToken
                ? 'Token set. Leave blank to keep the stored token.'
                : 'Optional. Sent as Authorization: Bearer on every call.'
            }
          >
            <Input.Password
              placeholder={editingRow?.hasAuthToken ? '••••••••  (unchanged)' : 'Optional token'}
              autoComplete="new-password"
            />
          </Form.Item>
          {editingRow?.hasAuthToken ? (
            <Form.Item name="clearAuthToken" valuePropName="checked" style={{ marginTop: -12 }}>
              <Checkbox>Clear the stored token</Checkbox>
            </Form.Item>
          ) : null}
          <Form.Item
            name="toolAllowlist"
            label="Tool allowlist"
            tooltip="Only these tool names register with Clio. An empty allowlist registers nothing."
          >
            <Select mode="tags" placeholder="Type a tool name and press Enter" open={false} />
          </Form.Item>
          <Form.Item
            name="readOnlyTools"
            label="Read-only tools"
            tooltip="Tools listed here skip the write-action audit serialization. Everything else is treated as side-effecting."
          >
            <Select mode="tags" placeholder="Type a tool name and press Enter" open={false} />
          </Form.Item>
        </Form>
      </Modal>
    </article>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
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
