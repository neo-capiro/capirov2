import { useState } from 'react';
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';

interface TeamRow {
  membershipId: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: 'capiro_admin' | 'user_admin' | 'standard_user' | 'client_portal_user';
  status: 'invited' | 'active' | 'removed';
  joinedAt: string | null;
  lastSeenAt: string | null;
}

interface InvitationRow {
  id: string;
  email: string;
  role: 'user_admin' | 'standard_user';
  createdAt: string;
  expiresAt: string | null;
}

export function TeamPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [form] = Form.useForm<{ email: string; role: 'user_admin' | 'standard_user' }>();

  const team = useQuery<TeamRow[]>({
    queryKey: ['team'],
    queryFn: async () => (await api.get('/api/tenant-admin/team')).data,
  });
  const invitations = useQuery<InvitationRow[]>({
    queryKey: ['team', 'invitations'],
    queryFn: async () => (await api.get('/api/tenant-admin/team/invitations')).data,
  });

  const invite = useMutation({
    mutationFn: async (input: { email: string; role: 'user_admin' | 'standard_user' }) =>
      (await api.post('/api/tenant-admin/team/invite', input)).data,
    onSuccess: () => {
      message.success('Invitation sent');
      setInviteOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['team', 'invitations'] });
    },
    onError: (err) => message.error((err as Error).message),
  });

  const remove = useMutation({
    mutationFn: async (userId: string) =>
      (await api.delete(`/api/tenant-admin/team/${userId}`)).data,
    onSuccess: () => {
      message.success('Member removed');
      qc.invalidateQueries({ queryKey: ['team'] });
    },
  });

  const resend = useMutation({
    mutationFn: async (invitationId: string) =>
      (await api.post(`/api/tenant-admin/team/invitations/${invitationId}/resend`)).data,
    onSuccess: () => {
      message.success('Invitation re-sent');
      qc.invalidateQueries({ queryKey: ['team', 'invitations'] });
    },
  });

  return (
    <>
      <Space style={{ marginBottom: 16, justifyContent: 'flex-end', width: '100%' }}>
        <Button type="primary" onClick={() => setInviteOpen(true)}>
          Invite team member
        </Button>
      </Space>
      <Tabs
        items={[
          {
            key: 'members',
            label: `Members (${team.data?.length ?? 0})`,
            children: (
              <Table<TeamRow>
                rowKey="membershipId"
                loading={team.isLoading}
                dataSource={team.data ?? []}
                pagination={false}
                columns={[
                  {
                    title: 'Email',
                    dataIndex: 'email',
                    render: (v, r) =>
                      r.firstName || r.lastName
                        ? `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() + ` <${v}>`
                        : v,
                  },
                  {
                    title: 'Role',
                    dataIndex: 'role',
                    width: 160,
                    render: (v) => <Tag>{v.replace(/_/g, ' ')}</Tag>,
                  },
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    width: 110,
                    render: (v: TeamRow['status']) => (
                      <Tag color={v === 'active' ? 'green' : v === 'removed' ? 'default' : 'gold'}>
                        {v}
                      </Tag>
                    ),
                  },
                  { title: 'Joined', dataIndex: 'joinedAt', width: 200 },
                  {
                    title: '',
                    width: 100,
                    render: (_v, r) =>
                      r.status === 'active' ? (
                        <Popconfirm
                          title="Remove from tenant?"
                          okText="Remove"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => remove.mutate(r.userId)}
                        >
                          <Button danger size="small">
                            Remove
                          </Button>
                        </Popconfirm>
                      ) : null,
                  },
                ]}
              />
            ),
          },
          {
            key: 'invitations',
            label: `Pending invitations (${invitations.data?.length ?? 0})`,
            children: (
              <Table<InvitationRow>
                rowKey="id"
                loading={invitations.isLoading}
                dataSource={invitations.data ?? []}
                pagination={false}
                columns={[
                  { title: 'Email', dataIndex: 'email' },
                  {
                    title: 'Role',
                    dataIndex: 'role',
                    width: 160,
                    render: (v) => <Tag>{v.replace(/_/g, ' ')}</Tag>,
                  },
                  { title: 'Sent', dataIndex: 'createdAt', width: 200 },
                  { title: 'Expires', dataIndex: 'expiresAt', width: 200 },
                  {
                    title: '',
                    width: 110,
                    render: (_v, r) => (
                      <Button size="small" onClick={() => resend.mutate(r.id)}>
                        Resend
                      </Button>
                    ),
                  },
                ]}
              />
            ),
          },
        ]}
      />
      <Modal
        title="Invite team member"
        open={inviteOpen}
        onCancel={() => setInviteOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={invite.isPending}
        okText="Send invitation"
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ role: 'standard_user' }}
          onFinish={(values) => invite.mutate(values)}
        >
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input placeholder="teammate@example.com" />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'standard_user', label: 'Standard user' },
                { value: 'user_admin', label: 'User admin' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
