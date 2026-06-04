import { useState } from 'react';
import { App as AntApp, Button, Empty, Input, List, Popconfirm, Spin, Tag, Typography } from 'antd';
import { DeleteOutlined, FileTextOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../../lib/use-api.js';

export interface ClientBrief {
  id: string;
  title: string;
  body: string;
  sourceAlertId: string | null;
  sourceType: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ClientBriefSectionProps {
  clientId: string | null;
  /** Lets the user fold a brief into the outreach intelligence notes. */
  onInject?: (text: string) => void;
}

/**
 * Client Brief subsection for the Outreach wizard context step. All briefs saved
 * from the Top alerts card (and free-form notes) surface here, so a lobbyist
 * drafting outreach sees the running brief for the client in one place.
 */
export function ClientBriefSection({ clientId, onInject }: ClientBriefSectionProps) {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const briefsQuery = useQuery<ClientBrief[]>({
    queryKey: ['client-briefs', clientId],
    queryFn: async () =>
      (await api.get<ClientBrief[]>(`/api/intelligence/clients/${clientId}/briefs`)).data,
    enabled: !!clientId,
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: async (input: { title: string; body: string }) => {
      await api.post(`/api/intelligence/clients/${clientId}/briefs`, {
        title: input.title,
        body: input.body,
        sourceType: 'manual',
      });
    },
    onSuccess: () => {
      message.success('Brief note added');
      setDraftTitle('');
      setDraftBody('');
      void qc.invalidateQueries({ queryKey: ['client-briefs', clientId] });
    },
    onError: () => message.error('Could not add the brief note — please try again'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (briefId: string) => {
      await api.delete(`/api/intelligence/clients/${clientId}/briefs/${encodeURIComponent(briefId)}`);
    },
    onSuccess: () => {
      message.success('Brief note removed');
      void qc.invalidateQueries({ queryKey: ['client-briefs', clientId] });
    },
    onError: () => message.error('Could not remove the brief note — please try again'),
  });

  if (!clientId) return null;

  const briefs = briefsQuery.data ?? [];

  const handleAdd = () => {
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title || !body) {
      void message.warning('Add a title and a note before saving.');
      return;
    }
    addMutation.mutate({ title, body });
  };

  return (
    <div style={{ marginTop: 8 }}>
      <Typography.Text strong style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <FileTextOutlined style={{ color: 'var(--accent-ink)' }} />
        Client brief
        {briefs.length > 0 && <Tag style={{ marginLeft: 4 }}>{briefs.length}</Tag>}
      </Typography.Text>

      {briefsQuery.isLoading ? (
        <div style={{ padding: 16, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : briefs.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No saved briefs yet. Promote an alert from the client's Top alerts, or add a note below."
          style={{ margin: '8px 0' }}
        />
      ) : (
        <List
          size="small"
          dataSource={briefs}
          renderItem={(brief) => (
            <List.Item
              actions={[
                ...(onInject
                  ? [
                      <Button
                        key="inject"
                        type="link"
                        size="small"
                        onClick={() => onInject(`${brief.title}: ${brief.body}`)}
                      >
                        Inject →
                      </Button>,
                    ]
                  : []),
                <Popconfirm
                  key="del"
                  title="Remove this brief note?"
                  onConfirm={() => deleteMutation.mutate(brief.id)}
                  okButtonProps={{ loading: deleteMutation.isPending }}
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="Remove brief" />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <span style={{ fontSize: 13 }}>
                    {brief.title}
                    {brief.sourceType && brief.sourceType !== 'manual' && (
                      <Tag style={{ marginLeft: 6 }} color="blue">
                        {brief.sourceType}
                      </Tag>
                    )}
                  </span>
                }
                description={<span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{brief.body}</span>}
              />
            </List.Item>
          )}
        />
      )}

      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Input
          size="small"
          placeholder="Brief note title"
          value={draftTitle}
          maxLength={300}
          onChange={(e) => setDraftTitle(e.target.value)}
        />
        <Input.TextArea
          rows={2}
          placeholder="What should the team remember for this client?"
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
        />
        <Button
          size="small"
          icon={<PlusOutlined />}
          loading={addMutation.isPending}
          onClick={handleAdd}
          style={{ alignSelf: 'flex-start' }}
        >
          Add to brief
        </Button>
      </div>
    </div>
  );
}
