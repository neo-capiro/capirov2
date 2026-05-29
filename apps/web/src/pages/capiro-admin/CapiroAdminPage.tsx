import { useState } from 'react';
import { App, Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import { useImpersonation } from '../../state/impersonation.js';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  clerkOrgId: string | null;
  logoS3Key: string | null;
  createdAt: string;
  _count: { memberships: number; clients: number };
}

interface CreateTenantInput {
  slug: string;
  name: string;
  adminEmail: string;
}

export function CapiroAdminPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { start: startImpersonation } = useImpersonation();
  const [open, setOpen] = useState(false);
  const [impOpen, setImpOpen] = useState<TenantRow | null>(null);
  const [form] = Form.useForm<CreateTenantInput>();
  const [reasonForm] = Form.useForm<{ reason: string }>();

  const tenants = useQuery<TenantRow[]>({
    queryKey: ['capiro-admin', 'tenants'],
    queryFn: async () => (await api.get('/api/capiro-admin/tenants')).data,
  });

  const create = useMutation({
    mutationFn: async (input: CreateTenantInput) =>
      (await api.post('/api/capiro-admin/tenants', input)).data,
    onSuccess: () => {
      message.success('Tenant created and admin provisioned in Clerk');
      setOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['capiro-admin', 'tenants'] });
    },
    onError: (err) => message.error((err as Error).message),
  });

  const impersonate = useMutation({
    mutationFn: async (input: { tenantId: string; tenantSlug: string; reason: string }) =>
      (
        await api.post('/api/capiro-admin/impersonate', {
          tenantId: input.tenantId,
          reason: input.reason,
        })
      ).data,
    onSuccess: (_data, vars) => {
      startImpersonation(vars.tenantSlug);
      setImpOpen(null);
      reasonForm.resetFields();
      qc.invalidateQueries(); // any data is now from the impersonated tenant
      message.success(`Acting as ${vars.tenantSlug}. Use the chip in the header to end.`);
      navigate('/');
    },
    onError: (err) => message.error((err as Error).message),
  });

  return (
    <>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Capiro Admin · Tenants
        </Typography.Title>
        <Button type="primary" onClick={() => setOpen(true)}>
          Create tenant
        </Button>
      </Space>
      <Table<TenantRow>
        rowKey="id"
        loading={tenants.isLoading}
        dataSource={tenants.data ?? []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'Slug', dataIndex: 'slug', width: 200 },
          { title: 'Name', dataIndex: 'name' },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 110,
            render: (v) => (
              <Tag color={v === 'active' ? 'green' : v === 'suspended' ? 'red' : 'gold'}>{v}</Tag>
            ),
          },
          {
            title: 'Members',
            width: 100,
            render: (_v, r) => r._count.memberships,
          },
          {
            title: 'Clients',
            width: 100,
            render: (_v, r) => r._count.clients,
          },
          { title: 'Created', dataIndex: 'createdAt', width: 200 },
          {
            title: '',
            width: 120,
            render: (_v, r) => (
              <Popconfirm
                title="Impersonate this tenant?"
                description="A reason will be required and audit-logged."
                okText="Continue"
                onConfirm={() => setImpOpen(r)}
              >
                <Button size="small">Impersonate</Button>
              </Popconfirm>
            ),
          },
        ]}
      />

      {/* Create tenant */}
      <Modal
        title="Create tenant + provision admin"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
        okText="Create + provision"
      >
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item
            name="slug"
            label="Tenant slug"
            extra="Lowercase, [a-z0-9-]. The first label of the tenant subdomain (slug.app.capiro.ai)."
            rules={[
              { required: true },
              {
                pattern: /^[a-z0-9][a-z0-9-]{1,62}$/,
                message: 'Lowercase, 2-63 chars, [a-z0-9-], cannot start with a hyphen',
              },
            ]}
          >
            <Input placeholder="acme-lobbying" />
          </Form.Item>
          <Form.Item name="name" label="Display name" rules={[{ required: true, min: 2 }]}>
            <Input placeholder="Acme Lobbying Group" />
          </Form.Item>
          <Form.Item
            name="adminEmail"
            label="Admin email"
            rules={[{ required: true, type: 'email' }]}
          >
            <Input placeholder="admin@acme.com" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Reason for impersonation */}
      <Modal
        title={impOpen ? `Impersonate ${impOpen.slug}` : ''}
        open={!!impOpen}
        onCancel={() => setImpOpen(null)}
        onOk={() => reasonForm.submit()}
        confirmLoading={impersonate.isPending}
        okText="Start impersonation"
      >
        <Typography.Paragraph type="secondary">
          The reason is recorded in the audit log alongside your user id. Any data access during
          this session is attributed to you, not the tenant's admin.
        </Typography.Paragraph>
        <Form
          form={reasonForm}
          layout="vertical"
          onFinish={(v) =>
            impOpen &&
            impersonate.mutate({ tenantId: impOpen.id, tenantSlug: impOpen.slug, reason: v.reason })
          }
        >
          <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 10, max: 500 }]}>
            <Input.TextArea rows={3} placeholder="Investigating ticket #1234, invitation flow" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
