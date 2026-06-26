import { useMemo, useState } from 'react';
import {
  Alert, App, Button, Card, Drawer, Empty, Input, Segmented, Select, Space, Spin, Tag, Typography,
} from 'antd';
import { RobotOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import { useMe } from '../../lib/me.js';

const { Text, Paragraph, Title } = Typography;

/**
 * Settings → Memory tab. Users view and edit the core memory MD files for the
 * FIRM (soul/compass/playbook) and per CLIENT (soul/compass/people). Each
 * section shows greyed help (the catalog prompt) + an example. Editing firm
 * files requires user_admin (enforced server-side too). A "Fill with Meri"
 * interview drafts sections from a short Q&A.
 */

interface SectionDef { key: string; heading: string; prompt: string; example: string }
interface FileDef { type: string; scope: 'firm' | 'client' | 'user'; label: string; blurb: string; sections: SectionDef[] }
interface ItemSection { key: string; heading: string; owner: 'engine' | 'human'; body: string; prompt: string; example: string }
interface ItemSectionsResp {
  type: string; slug: string; title: string; visibility: string;
  clientId: string | null; updatedAt: string; sections: ItemSection[];
}

export function MemorySettingsPage() {
  const api = useApi();
  const me = useMe();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const isAdmin = me.data?.role === 'user_admin' || me.data?.role === 'capiro_admin';

  const [scope, setScope] = useState<'firm' | 'client'>('firm');
  const [fileType, setFileType] = useState<string>('firm-soul');
  const [clientId, setClientId] = useState<string | undefined>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [interviewOpen, setInterviewOpen] = useState(false);

  const catalogQuery = useQuery<FileDef[]>({
    queryKey: ['memory-catalog'],
    queryFn: async () => (await api.get<FileDef[]>('/api/memory/catalog')).data,
    staleTime: 60 * 60 * 1000,
  });

  const clientsQuery = useQuery<{ id: string; name: string }[]>({
    queryKey: ['memory-clients'],
    queryFn: async () => (await api.get<{ data: { id: string; name: string }[] }>(
      '/api/lda-intel/clients', { params: { limit: 200 } })).data.data ?? [],
    staleTime: 10 * 60 * 1000,
  });

  // slug: firm files key on a fixed firm slug; client files key on clientId.
  const slug = scope === 'firm' ? 'firm' : clientId ?? '';
  const ready = scope === 'firm' || !!clientId;

  const itemQuery = useQuery<ItemSectionsResp>({
    queryKey: ['memory-item', fileType, slug],
    queryFn: async () => (await api.get<ItemSectionsResp>(`/api/memory/items/${fileType}/${slug}/sections`)).data,
    enabled: ready,
    retry: 1,
  });

  const filesForScope = useMemo(
    () => (catalogQuery.data ?? []).filter((f) => f.scope === scope),
    [catalogQuery.data, scope],
  );

  const saveMutation = useMutation({
    mutationFn: async (sections: { key: string; body: string }[]) =>
      (await api.put(`/api/memory/items/${fileType}/${slug}/sections`, { sections })).data,
    onSuccess: () => {
      message.success('Saved');
      setDrafts({});
      qc.invalidateQueries({ queryKey: ['memory-item', fileType, slug] });
    },
    onError: (e: unknown) => message.error(e instanceof Error ? e.message : 'Save failed'),
  });

  function bodyFor(s: ItemSection): string {
    return drafts[s.key] ?? s.body;
  }
  const dirty = Object.keys(drafts).length > 0;

  function onSave() {
    const edited = Object.entries(drafts).map(([key, body]) => ({ key, body }));
    saveMutation.mutate(edited);
  }

  return (
    <Card>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={4} style={{ marginBottom: 4 }}>Memory Files</Title>
          <Text type="secondary">
            These files are the firm and client knowledge that grounds Meri and the knowledge graph.
            Write in your own voice; the greyed hints show what belongs in each section.
          </Text>
        </div>

        <Space wrap>
          <Segmented
            value={scope}
            onChange={(v) => { setScope(v as 'firm' | 'client'); setDrafts({}); setFileType(v === 'firm' ? 'firm-soul' : 'client-soul'); }}
            options={[{ label: 'Firm', value: 'firm' }, { label: 'By client', value: 'client' }]}
          />
          {scope === 'client' && (
            <Select
              showSearch placeholder="Select client" style={{ width: 220 }}
              value={clientId} onChange={(v) => { setClientId(v); setDrafts({}); }}
              loading={clientsQuery.isLoading}
              options={(clientsQuery.data ?? []).map((c) => ({ label: c.name, value: c.id }))}
              filterOption={(i, o) => (o?.label as string ?? '').toLowerCase().includes(i.toLowerCase())}
            />
          )}
          <Select
            style={{ width: 200 }}
            value={fileType} onChange={(v) => { setFileType(v); setDrafts({}); }}
            options={filesForScope.map((f) => ({ label: f.label, value: f.type }))}
          />
          <Button icon={<RobotOutlined />} onClick={() => setInterviewOpen(true)} disabled={!ready}>
            Fill with Meri
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={onSave} loading={saveMutation.isPending} disabled={!dirty || !isAdmin}>
            Save changes
          </Button>
        </Space>

        {!isAdmin && (
          <Alert type="info" showIcon message="You can view these files. Editing firm and client memory requires an admin role." />
        )}

        {scope === 'client' && !clientId && <Empty description="Pick a client to view their memory files." />}

        {ready && itemQuery.isLoading && <Spin />}
        {ready && itemQuery.isError && (
          <Empty description="This file hasn't been created yet. Use “Fill with Meri” or save content to start it." />
        )}

        {ready && itemQuery.data && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {itemQuery.data.sections.map((s) => (
              <div key={s.key}>
                <Space>
                  <Text strong>{s.heading}</Text>
                  {s.owner === 'engine' && <Tag color="default">auto-generated</Tag>}
                </Space>
                <Paragraph type="secondary" style={{ margin: '2px 0', fontSize: 12 }}>
                  {s.prompt} {s.example && <Text type="secondary" italic>e.g. “{s.example}”</Text>}
                </Paragraph>
                <Input.TextArea
                  value={bodyFor(s)}
                  autoSize={{ minRows: 2, maxRows: 8 }}
                  readOnly={s.owner === 'engine' || !isAdmin}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                  style={s.owner === 'engine' ? { background: '#f5f5f5' } : undefined}
                />
              </div>
            ))}
          </Space>
        )}
      </Space>

      <InterviewDrawer
        open={interviewOpen}
        onClose={() => setInterviewOpen(false)}
        fileType={fileType}
        fileLabel={filesForScope.find((f) => f.type === fileType)?.label ?? fileType}
        onApply={(sections) => {
          setDrafts((d) => {
            const next = { ...d };
            for (const s of sections) next[s.key] = s.body;
            return next;
          });
          setInterviewOpen(false);
          message.info('Draft applied — review and Save changes.');
        }}
      />
    </Card>
  );
}

interface InterviewQuestion { sectionKey: string; heading: string; question: string; example: string }

function InterviewDrawer(props: {
  open: boolean; onClose: () => void; fileType: string; fileLabel: string;
  onApply: (sections: { key: string; body: string }[]) => void;
}) {
  const api = useApi();
  const { message } = App.useApp();
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const questionsQuery = useQuery<{ questions: InterviewQuestion[] }>({
    queryKey: ['memory-interview-q', props.fileType],
    queryFn: async () => (await api.get(`/api/memory/interview/${props.fileType}/questions`)).data,
    enabled: props.open,
  });

  const draftMutation = useMutation({
    mutationFn: async () => {
      const payload = Object.entries(answers)
        .filter(([, v]) => v.trim())
        .map(([sectionKey, answer]) => ({ sectionKey, answer }));
      return (await api.post(`/api/memory/interview/${props.fileType}/draft`, { answers: payload })).data as {
        sections: { key: string; body: string }[];
      };
    },
    onSuccess: (data) => props.onApply(data.sections ?? []),
    onError: (e: unknown) => message.error(e instanceof Error ? e.message : 'Draft failed'),
  });

  return (
    <Drawer
      title={<Space><RobotOutlined /> Fill “{props.fileLabel}” with Meri</Space>}
      width={520} open={props.open} onClose={props.onClose}
      extra={
        <Button type="primary" loading={draftMutation.isPending}
          onClick={() => draftMutation.mutate()}
          disabled={!Object.values(answers).some((v) => v.trim())}>
          Generate draft
        </Button>
      }
    >
      <Paragraph type="secondary">
        Answer in plain language — Meri turns your answers into the file. You can edit everything before saving.
      </Paragraph>
      {questionsQuery.isLoading && <Spin />}
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {(questionsQuery.data?.questions ?? []).map((q) => (
          <div key={q.sectionKey}>
            <Text strong>{q.question}</Text>
            <Paragraph type="secondary" italic style={{ margin: '2px 0', fontSize: 12 }}>e.g. “{q.example}”</Paragraph>
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 6 }}
              value={answers[q.sectionKey] ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.sectionKey]: e.target.value }))}
            />
          </div>
        ))}
      </Space>
    </Drawer>
  );
}
