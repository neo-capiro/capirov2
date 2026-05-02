import { useState } from 'react';
import { App, Button, Form, Input, Modal, Space, Table, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';

interface Client {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  productDescription: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  status: string;
  createdAt: string;
}

export function ClientsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const list = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get('/api/clients')).data,
  });

  const create = useMutation({
    mutationFn: async (input: Partial<Client>) => (await api.post('/api/clients', input)).data,
    onSuccess: () => {
      message.success('Client added');
      setOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => message.error((err as Error).message),
  });

  return (
    <>
      <Space style={{ marginBottom: 16, justifyContent: 'flex-end', width: '100%' }}>
        <Button type="primary" onClick={() => setOpen(true)}>
          Add client
        </Button>
      </Space>
      <Table<Client>
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data ?? []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          {
            title: 'Website',
            dataIndex: 'website',
            render: (v) =>
              v ? (
                <Typography.Link href={v.startsWith('http') ? v : `https://${v}`} target="_blank">
                  {v}
                </Typography.Link>
              ) : (
                '—'
              ),
          },
          {
            title: 'Primary contact',
            render: (_v, r) =>
              r.primaryContactName
                ? `${r.primaryContactName}${r.primaryContactEmail ? ` <${r.primaryContactEmail}>` : ''}`
                : '—',
          },
          { title: 'Status', dataIndex: 'status', width: 110 },
          { title: 'Added', dataIndex: 'createdAt', width: 200 },
        ]}
      />

      <Modal
        title="Add client"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
        okText="Add client"
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="name" label="Company name" rules={[{ required: true, min: 1 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="website" label="Website">
            <Input placeholder="example.com" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="productDescription" label="Product / service description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="primaryContactName" label="Primary contact name">
            <Input />
          </Form.Item>
          <Form.Item
            name="primaryContactEmail"
            label="Primary contact email"
            rules={[{ type: 'email' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="primaryContactPhone" label="Primary contact phone">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
