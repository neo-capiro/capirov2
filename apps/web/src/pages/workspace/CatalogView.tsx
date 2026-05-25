import { useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button, Card, Divider, Empty, Skeleton, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../lib/use-api.js';
import type { TemplateCategory, WorkflowTemplate } from './workflowTypes.js';

const CATEGORY_ORDER: TemplateCategory[] = ['authorization', 'appropriations', 'language', 'supporting'];

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  authorization: 'Authorization (NDAA)',
  appropriations: 'House Appropriations',
  language: 'Language Requests',
  supporting: 'Supporting Documents',
};

const CATEGORY_TAG_COLORS: Record<TemplateCategory, string> = {
  authorization: 'geekblue',
  appropriations: 'blue',
  language: 'purple',
  supporting: 'cyan',
};

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
      navigate('/workspace/workflows');
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

  const grouped = activeTemplates.reduce<Record<string, WorkflowTemplate[]>>((acc, t) => {
    (acc[t.category] = acc[t.category] ?? []).push(t);
    return acc;
  }, {});

  const visibleCategories = CATEGORY_ORDER.filter((cat) => (grouped[cat]?.length ?? 0) > 0);

  return (
    <div className="catalog-view">
      {visibleCategories.map((cat) => (
        <div key={cat} className="catalog-category">
          <Divider orientation="left" orientationMargin={0}>
            <span className="catalog-category-title">{CATEGORY_LABELS[cat]}</span>
            <Tag className="catalog-category-count">{grouped[cat]?.length ?? 0}</Tag>
          </Divider>
          <div className="catalog-grid">
            {(grouped[cat] ?? []).map((template) => (
              <Card key={template.id} className="catalog-card">
                <div className="catalog-card-body">
                  <Tag color={CATEGORY_TAG_COLORS[template.category]} className="catalog-card-badge">
                    {CATEGORY_LABELS[template.category]}
                  </Tag>
                  <Typography.Text strong className="catalog-card-name">
                    {template.name}
                  </Typography.Text>
                  <Typography.Paragraph
                    type="secondary"
                    className="catalog-card-desc"
                    ellipsis={{ rows: 2 }}
                  >
                    {template.description ?? 'No description available.'}
                  </Typography.Paragraph>
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
      ))}
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
