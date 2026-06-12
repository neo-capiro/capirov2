/**
 * Settings → AI Usage: a tenant admin's view of their OWN AI spend
 * (estimated; the pricing table is hand-maintained) plus the optional
 * bring-your-own-key card. Keys are write-only: the form sends the key once,
 * the API validates it against the provider before storing, and from then on
 * only `•••• last4` is ever displayed. Server-side RolesGuard (user_admin)
 * is the security boundary; the Settings tab filter is UI affordance.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useApi } from '../../lib/use-api.js';
import {
  UsageSummaryPanels,
  type MaskedAiCredential,
  type TenantUsageSummary,
} from '../../components/ai-usage/UsageSummaryPanels.js';

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
];

interface SaveKeyFormValues {
  provider: 'openai' | 'anthropic';
  apiKey: string;
  modelOverride?: string;
}

/** Surface the API's message (e.g. the provider's key-validation error). */
export function apiErrorMessage(err: unknown): string {
  const data = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  if (data?.message) return Array.isArray(data.message) ? data.message.join('; ') : data.message;
  return err instanceof Error ? err.message : 'Request failed';
}

export function AiUsagePage() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [form] = Form.useForm<SaveKeyFormValues>();

  const from = useMemo(
    () => new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString(),
    [rangeDays],
  );

  const summary = useQuery<TenantUsageSummary>({
    queryKey: ['ai-usage', 'summary', rangeDays],
    queryFn: async () =>
      (await api.get<TenantUsageSummary>('/api/ai-usage/summary', { params: { from } })).data,
  });

  const credentials = useQuery<MaskedAiCredential[]>({
    queryKey: ['ai-usage', 'credential'],
    queryFn: async () => (await api.get<MaskedAiCredential[]>('/api/ai-usage/credential')).data,
  });

  const saveKey = useMutation({
    mutationFn: async (values: SaveKeyFormValues) =>
      (
        await api.post<MaskedAiCredential>('/api/ai-usage/credential', values, {
          // The save endpoint makes a real validation call to the provider
          // before storing; give it headroom beyond the global 20s default.
          timeout: 45_000,
        })
      ).data,
    onSuccess: (saved) => {
      message.success(`${saved.provider} key validated and saved (•••• ${saved.last4})`);
      form.resetFields(['apiKey']);
      qc.invalidateQueries({ queryKey: ['ai-usage', 'credential'] });
    },
    onError: (err) => message.error(apiErrorMessage(err)),
  });

  const removeKey = useMutation({
    mutationFn: async (provider: string) =>
      (await api.delete(`/api/ai-usage/credential/${provider}`)).data,
    onSuccess: (_data, provider) => {
      message.success(`${provider} key removed — generations fall back to the Capiro shared key`);
      qc.invalidateQueries({ queryKey: ['ai-usage', 'credential'] });
    },
    onError: (err) => message.error(apiErrorMessage(err)),
  });

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          AI Usage &amp; Spend
        </Typography.Title>
        <Segmented
          options={[
            { label: '7 days', value: 7 },
            { label: '30 days', value: 30 },
            { label: '90 days', value: 90 },
          ]}
          value={rangeDays}
          onChange={(v) => setRangeDays(Number(v))}
        />
      </Space>

      {summary.isError ? (
        <Alert
          type="error"
          showIcon
          message="Couldn't load AI usage."
          description={apiErrorMessage(summary.error)}
          style={{ marginBottom: 16 }}
        />
      ) : (
        <UsageSummaryPanels summary={summary.data} loading={summary.isLoading} />
      )}

      <Card size="small" title="Bring your own AI key" style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          Optional: use your firm&apos;s own OpenAI or Anthropic API key for generations. Keys are
          validated against the provider before saving, stored encrypted, and never displayed again
          — only the last 4 characters are shown. Removing a key falls back to the Capiro shared
          key.
        </Typography.Paragraph>

        {(credentials.data ?? []).map((cred) => (
          <Space key={cred.provider} style={{ display: 'flex', marginBottom: 8 }} wrap>
            <Tag color="blue">{cred.provider}</Tag>
            <Typography.Text code>•••• {cred.last4}</Typography.Text>
            {cred.modelOverride ? <Tag>{cred.modelOverride}</Tag> : null}
            <Tag color={cred.status === 'active' ? 'green' : 'orange'}>{cred.status}</Tag>
            <Popconfirm
              title={`Remove the ${cred.provider} key?`}
              description="Generations fall back to the Capiro shared key."
              onConfirm={() => removeKey.mutate(cred.provider)}
            >
              <Button size="small" danger loading={removeKey.isPending}>
                Remove
              </Button>
            </Popconfirm>
          </Space>
        ))}

        <Form<SaveKeyFormValues>
          form={form}
          layout="inline"
          initialValues={{ provider: 'openai' }}
          onFinish={(values) => saveKey.mutate(values)}
          style={{ marginTop: 8, rowGap: 8 }}
        >
          <Form.Item name="provider" rules={[{ required: true }]}>
            <Select options={PROVIDER_OPTIONS} style={{ width: 130 }} />
          </Form.Item>
          <Form.Item
            name="apiKey"
            rules={[{ required: true, message: 'API key is required' }, { min: 8 }]}
          >
            <Input.Password
              placeholder="Paste API key (write-only)"
              autoComplete="off"
              style={{ width: 280 }}
            />
          </Form.Item>
          <Form.Item name="modelOverride">
            <Input placeholder="Model override (optional)" style={{ width: 220 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saveKey.isPending}>
              Validate &amp; save
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
