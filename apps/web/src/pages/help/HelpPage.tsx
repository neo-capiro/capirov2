import { useMemo, useState } from 'react';
import { Alert, Card, Empty, Input, Modal, Spin, Tag, Typography } from 'antd';
import {
  ExportOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';

interface HelpItem {
  id: string;
  title: string;
  description: string;
  type: 'video' | 'guide';
  durationLabel?: string;
  url: string | null;
  thumbnailUrl: string | null;
}

interface HelpCategory {
  id: string;
  title: string;
  description?: string;
  items: HelpItem[];
}

export function HelpPage() {
  const api = useApi();
  const [query, setQuery] = useState('');
  const [activeVideo, setActiveVideo] = useState<HelpItem | null>(null);

  const { data, isLoading, isError, error } = useQuery<HelpCategory[]>({
    queryKey: ['help-content'],
    queryFn: async () => (await api.get<HelpCategory[]>('/api/help/content')).data,
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const categories = data ?? [];
    if (!q) return categories;
    return categories
      .map((category) => ({
        ...category,
        items: category.items.filter(
          (item) =>
            item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
        ),
      }))
      .filter((category) => category.items.length > 0);
  }, [data, query]);

  const openItem = (item: HelpItem) => {
    if (!item.url) return;
    if (item.type === 'video') setActiveVideo(item);
    else window.open(item.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="help-page"
      style={{ maxWidth: 1120, margin: '0 auto', padding: '8px 4px 48px' }}
    >
      <Typography.Title level={2} style={{ marginBottom: 4 }}>
        <QuestionCircleOutlined style={{ marginRight: 10 }} />
        Help center
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
        How-to videos and guides for getting the most out of Capiro.
      </Typography.Paragraph>

      <Input
        allowClear
        size="large"
        prefix={<SearchOutlined />}
        placeholder="Search help videos and guides…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        style={{ maxWidth: 480, marginBottom: 28 }}
        aria-label="Search help content"
      />

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" />
        </div>
      ) : isError ? (
        <Alert
          type="error"
          showIcon
          message="Couldn't load help content"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : filtered.length === 0 ? (
        <Empty description={query ? 'No matching help content' : 'No help content yet'} />
      ) : (
        filtered.map((category) => (
          <section key={category.id} style={{ marginBottom: 36 }}>
            <Typography.Title level={4} style={{ marginBottom: 2 }}>
              {category.title}
            </Typography.Title>
            {category.description ? (
              <Typography.Paragraph type="secondary" style={{ marginBottom: 14 }}>
                {category.description}
              </Typography.Paragraph>
            ) : null}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16,
              }}
            >
              {category.items.map((item) => (
                <Card
                  key={item.id}
                  size="small"
                  hoverable={Boolean(item.url)}
                  onClick={() => openItem(item)}
                  cover={<HelpCover item={item} />}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Tag
                      color={item.type === 'video' ? 'blue' : 'green'}
                      icon={item.type === 'video' ? <PlayCircleOutlined /> : <ReadOutlined />}
                    >
                      {item.type === 'video' ? 'Video' : 'Guide'}
                    </Tag>
                    {item.durationLabel ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {item.durationLabel}
                      </Typography.Text>
                    ) : null}
                    {item.type === 'guide' && item.url ? (
                      <ExportOutlined style={{ marginLeft: 'auto', color: '#999' }} />
                    ) : null}
                  </div>
                  <Card.Meta
                    title={item.title}
                    description={<span style={{ fontSize: 13 }}>{item.description}</span>}
                  />
                  {!item.url ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Unavailable
                    </Typography.Text>
                  ) : null}
                </Card>
              ))}
            </div>
          </section>
        ))
      )}

      <Modal
        open={Boolean(activeVideo)}
        title={activeVideo?.title}
        footer={null}
        width={820}
        onCancel={() => setActiveVideo(null)}
        destroyOnClose
      >
        {activeVideo?.url ? (
          <video
            src={activeVideo.url}
            poster={activeVideo.thumbnailUrl ?? undefined}
            controls
            autoPlay
            style={{ width: '100%', borderRadius: 8 }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function HelpCover({ item }: { item: HelpItem }) {
  const isVideo = item.type === 'video';
  if (item.thumbnailUrl) {
    return (
      <div
        style={{
          position: 'relative',
          aspectRatio: '16 / 9',
          overflow: 'hidden',
          background: '#f0f0f0',
        }}
      >
        <img
          src={item.thumbnailUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {isVideo ? (
          <PlayCircleOutlined
            style={{
              position: 'absolute',
              inset: 0,
              margin: 'auto',
              fontSize: 44,
              color: '#fff',
              filter: 'drop-shadow(0 1px 4px rgba(0,0,0,.5))',
            }}
          />
        ) : null}
      </div>
    );
  }
  return (
    <div
      style={{
        aspectRatio: '16 / 9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isVideo ? '#e6f4ff' : '#f6ffed',
      }}
    >
      {isVideo ? (
        <PlayCircleOutlined style={{ fontSize: 40, color: '#1677ff' }} />
      ) : (
        <ReadOutlined style={{ fontSize: 38, color: '#52c41a' }} />
      )}
    </div>
  );
}
