import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Form, Input } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMe, type MeResponse } from '../../lib/me.js';
import { useApi } from '../../lib/use-api.js';

/**
 * Personal settings — the only Settings tab everyone sees. Identity surfaces
 * (email, password, MFA) live in Clerk's hosted UserButton modal; Capiro
 * surfaces the link here. Capiro-owned profile fields (currently just the
 * free-form job title shown under the user's name in the top-right widget)
 * live in this page.
 */
export function PersonalPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const me = useMe();
  const [title, setTitle] = useState('');

  useEffect(() => {
    setTitle(me.data?.user.title ?? '');
  }, [me.data?.user.title]);

  const saveTitle = useMutation({
    mutationFn: async (next: string) =>
      (await api.patch<MeResponse>('/api/me', { title: next })).data,
    onSuccess: (data) => {
      qc.setQueryData(['me'], data);
      message.success('Saved');
    },
    onError: (err: unknown) => {
      message.error(err instanceof Error ? err.message : 'Save failed');
    },
  });

  if (!me.data) return null;

  const trimmed = title.trim();
  const dirty = trimmed !== (me.data.user.title ?? '');

  return (
    <>
      <Card title="Profile" style={{ marginBottom: 16 }}>
        <Form layout="vertical">
          <Form.Item
            label="Title"
            extra="Displayed under your name in the top-right profile widget. e.g. “Sr. Government Affairs Lead”."
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add your title"
              maxLength={120}
              showCount
              allowClear
              style={{ maxWidth: 480 }}
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              disabled={!dirty || saveTitle.isPending}
              loading={saveTitle.isPending}
              onClick={() => saveTitle.mutate(trimmed)}
            >
              Save
            </Button>
          </Form.Item>
        </Form>
      </Card>
      <Card title="Account" style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="User ID">{me.data.user.id}</Descriptions.Item>
          <Descriptions.Item label="Tenant">{me.data.tenant.slug}</Descriptions.Item>
          <Descriptions.Item label="Role">{me.data.role}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="Identity (Clerk)">
        <Alert
          type="info"
          showIcon
          message="Email, password, and MFA settings are managed in Clerk."
          description="Click your account in the bottom-left navigation to open Clerk's account settings."
          style={{ marginBottom: 16 }}
        />
      </Card>
    </>
  );
}
