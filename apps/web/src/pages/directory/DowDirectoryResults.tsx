import { Avatar, Card, Drawer, Empty, Flex, List, Pagination, Space, Spin, Tag, Typography } from 'antd';
import type { AcquisitionPersonnelDetail, AcquisitionPersonnelListItem } from '../program-element/types.js';

const { Text, Link } = Typography;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

function confidenceBand(value: number): { label: 'high' | 'medium' | 'low'; color: 'green' | 'gold' | 'default' } {
  if (value >= 0.95) return { label: 'high', color: 'green' };
  if (value >= 0.8) return { label: 'medium', color: 'gold' };
  return { label: 'low', color: 'default' };
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface DowDirectoryResultsProps {
  persons: AcquisitionPersonnelListItem[];
  loading?: boolean;
  total: number;
  page: number;
  pageSize: number;
  isError?: boolean;
  onPage: (page: number) => void;
  onSelectPerson: (id: string) => void;
  onRetry?: () => void;
}

export function DowDirectoryResults({
  persons,
  loading = false,
  total,
  page,
  pageSize,
  isError = false,
  onPage,
  onSelectPerson,
  onRetry,
}: DowDirectoryResultsProps) {
  if (loading) {
    return (
      <div className="directory-grid-loading" style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (isError) {
    return (
      <Empty description="We couldn't load the DoW directory. Please try again.">
        {onRetry ? <Link onClick={onRetry}>Retry</Link> : null}
      </Empty>
    );
  }

  if (persons.length === 0) {
    return <Empty description="No DoW directory personnel found" />;
  }

  return (
    <>
      <div className="directory-card-grid">
        {persons.map((person) => {
          const band = confidenceBand(person.confidence);
          return (
            <Card
              key={person.id}
              hoverable
              size="small"
              onClick={() => onSelectPerson(person.id)}
              style={{ cursor: 'pointer' }}
            >
              <Flex gap={12} align="flex-start">
                <Avatar>{initials(person.fullName)}</Avatar>
                <Space direction="vertical" size={2} style={{ flex: 1, minWidth: 0 }}>
                  <Flex align="center" gap={8} wrap>
                    <Text strong>{person.fullName}</Text>
                    {person.role ? <Tag>{person.role}</Tag> : null}
                    <Tag color={band.color}>{band.label}</Tag>
                  </Flex>
                  <Text type="secondary">
                    {[person.title, person.organization].filter(Boolean).join(' • ') ||
                      'Title/organization unavailable'}
                  </Text>
                  <Text type="secondary">
                    {person.service ? `${person.service} • ` : ''}Last seen {formatDate(person.lastSeenAt)} •{' '}
                    {person.sourceCount} sources
                  </Text>
                </Space>
              </Flex>
            </Card>
          );
        })}
      </div>
      {total > pageSize ? (
        <div className="directory-pagination">
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            onChange={onPage}
            showSizeChanger={false}
          />
        </div>
      ) : null}
    </>
  );
}

export interface DowPersonDrawerProps {
  open: boolean;
  person: AcquisitionPersonnelDetail | null;
  loading?: boolean;
  onClose: () => void;
}

/** Detail drawer showing a person's full record + all source mentions. */
export function DowPersonDrawer({ open, person, loading = false, onClose }: DowPersonDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      title={person ? person.fullName : 'Personnel detail'}
      destroyOnClose
    >
      {loading || !person ? (
        <Spin />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Space direction="vertical" size={2}>
            {person.title ? <Text strong>{person.title}</Text> : null}
            {person.organization ? <Text type="secondary">{person.organization}</Text> : null}
            <Flex gap={8} wrap style={{ marginTop: 8 }}>
              {person.service ? <Tag>{person.service}</Tag> : null}
              {person.role ? <Tag>{person.role}</Tag> : null}
              <Tag color={confidenceBand(person.confidence).color}>
                {confidenceBand(person.confidence).label} confidence
              </Tag>
            </Flex>
            {person.publicProfileUrl ? (
              <Link href={person.publicProfileUrl} target="_blank" rel="noreferrer">
                Public profile →
              </Link>
            ) : null}
          </Space>

          <div>
            <Text strong>Source mentions ({person.sources.length})</Text>
            <List
              size="small"
              dataSource={person.sources}
              rowKey={(s) => s.id}
              locale={{ emptyText: 'No source mentions' }}
              renderItem={(s) => (
                <List.Item>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Flex align="center" gap={8} wrap>
                      <Tag>{s.source}</Tag>
                      <Text type="secondary">{formatDate(s.observedAt)}</Text>
                    </Flex>
                    {s.snippet ? <Text>{s.snippet}</Text> : null}
                    {s.sourceUrl ? (
                      <Link href={s.sourceUrl} target="_blank" rel="noreferrer">
                        Source →
                      </Link>
                    ) : null}
                  </Space>
                </List.Item>
              )}
            />
          </div>
        </Space>
      )}
    </Drawer>
  );
}
