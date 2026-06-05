import { useState } from 'react';
import { App, Button, Space, Table, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import { ClientFormModal } from '../clients/ClientFormModal.js';
import type { Client, ClientFormSubmit } from '../clients/clientTypes.js';

export function ClientsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);

  // The admin management table is the one surface that intentionally shows
  // archived clients (note the Status column), so it opts in via
  // includeArchived. A distinct query key avoids colliding with the
  // active-only ['clients'] cache the rest of the app reads; invalidating
  // ['clients'] still prefix-matches and refreshes this table.
  const list = useQuery<Client[]>({
    queryKey: ['clients', 'all'],
    queryFn: async () =>
      (await api.get<Client[]>('/api/clients', { params: { includeArchived: true } })).data,
  });

  const create = useMutation({
    mutationFn: async (input: ClientFormSubmit) => {
      const created = (await api.post<Client>('/api/clients', input.payload)).data;
      if (input.logo) await uploadClientLogo(api, created.id, input.logo);
      for (const document of input.documents) {
        await uploadClientDocument(api, created.id, document);
      }
      return created;
    },
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
        onSubmit={(submission) => create.mutate(submission)}
      />
    </>
  );
}

async function uploadClientLogo(api: ReturnType<typeof useApi>, clientId: string, file: File) {
  const presigned = (
    await api.post<{ url: string; fields: Record<string, string>; s3Key: string }>(
      `/api/clients/${clientId}/logo/upload-url`,
      { contentType: file.type, contentLength: file.size },
    )
  ).data;
  await uploadToS3(presigned, file);
  await api.post(`/api/clients/${clientId}/logo/confirm`, {
    s3Key: presigned.s3Key,
    contentType: file.type,
  });
}

async function uploadClientDocument(api: ReturnType<typeof useApi>, clientId: string, file: File) {
  const contentType = file.type || 'application/octet-stream';
  const presigned = (
    await api.post<{ url: string; fields: Record<string, string>; s3Key: string }>(
      '/api/engagement/attachments/upload-url',
      { clientId, fileName: file.name, contentType, contentLength: file.size },
    )
  ).data;
  await uploadToS3(presigned, file);
  await api.post('/api/engagement/attachments/confirm', {
    clientId,
    fileName: file.name,
    contentType,
    s3Key: presigned.s3Key,
  });
}

async function uploadToS3(presigned: { url: string; fields: Record<string, string> }, file: File) {
  const form = new FormData();
  for (const [key, value] of Object.entries(presigned.fields)) form.append(key, value);
  form.append('file', file);
  const response = await fetch(presigned.url, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
}
