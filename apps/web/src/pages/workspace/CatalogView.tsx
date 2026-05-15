import { useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button, Card, Empty, Skeleton, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../lib/use-api.js';
import type { WorkflowTemplate } from './workflowTypes.js';

export function CatalogView() {
  const api = useApi();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const qc = useQueryClient();
  const [addingSlug, setAddingSlug] = useState<string | null>(null);

  const templates = useQuery<WorkflowTemplate[]>({
    queryKey: ['workflow-templates'],
    queryFn: async () => (await api.get<WorkflowTemplate[]>('/api/workflows/templates')).data,
    staleTime: 60_000,
  });

  const createInstance = useMutation({
    mutationFn: async (templateSlug: string) =>
      (await api.post('/api/workflows/instances', { templateSlug })).data,
    onSuccess: () => {
      message.success('Workflow added to your board');
      qc.invalidateQueries({ queryKey: ['workflow-instances'] });
      navigate('/workspace/kanban');
    },
    onError: (err) => message.error(errorMessage(err)),
    onSettled: () => setAddingSlug(null),
  });

  const handleAdd = (slug: string) => {
    setAddingSlug(slug);
    createInstance.mutate(slug);
  };

  if (templates.isLoading) {
    return (
      <div className="catalog-view">
        <div className="catalog-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="catalog-card">
              <Skeleton active paragraph={{ rows: 3 }} />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const activeTemplates = (templates.data ?? [])
    .filter((t) => t.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (!activeTemplates.length) {
    return (
      <div className="catalog-view">
        <Empty description="No workflow templates available yet." style={{ marginTop: 80 }} />
      </div>
    );
  }

  return (
    <div className="catalog-view">
      <div className="catalog-grid">
        {activeTemplates.map((template) => (
          <Card key={template.id} className="catalog-card">
            <div className="catalog-card-body">
              <Tag color="blue" className="catalog-card-category">
                {template.category}
              </Tag>
              <Typography.Text strong className="catalog-card-name">
                {template.name}
              </Typography.Text>
              <Typography.Text type="secondary" className="catalog-card-desc">
                {template.description ?? 'No description available.'}
              </Typography.Text>
            </div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              className="catalog-card-action"
              loading={addingSlug === template.slug}
              disabled={createInstance.isPending && addingSlug !== template.slug}
              onClick={() => handleAdd(template.slug)}
            >
              Add to Workflows
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}
