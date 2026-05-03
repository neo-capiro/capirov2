import { useState } from 'react';
import { App, Button, Space, Table, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import { ClientFormModal } from '../clients/ClientFormModal.js';
import type { Client, ClientPayload } from '../clients/clientTypes.js';

export function ClientsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);

  const list = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Client[]>('/api/clients')).data,
  });

  const create = useMutation({
    mutationFn: async (input: ClientPayload) => (await api.post('/api/clients', input)).data,
    onSuccess: () => {
      message.success('Client added');
      setOpen(false);
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
            render: (value) =>
              value ? (
                <Typography.Link
                  href={value.startsWith('http') ? value : `https://${value}`}
                  target="_blank"
                >
                  {value}
                </Typography.Link>
              ) : (
                '-'
              ),
          },
          {
            title: 'Primary contact',
            render: (_value, record) =>
              record.primaryContactName
                ? `${record.primaryContactName}${
                    record.primaryContactEmail ? ` <${record.primaryContactEmail}>` : ''
                  }`
                : '-',
          },
          { title: 'Status', dataIndex: 'status', width: 110 },
          { title: 'Added', dataIndex: 'createdAt', width: 200 },
        ]}
      />

      <ClientFormModal
        open={open}
        mode="create"
        client={null}
        submitting={create.isPending}
        onCancel={() => setOpen(false)}
        onSubmit={(payload) => create.mutate(payload)}
      />
    </>
  );
}
