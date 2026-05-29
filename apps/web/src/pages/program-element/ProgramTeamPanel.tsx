import { Avatar, Button, Card, Empty, Flex, List, Skeleton, Space, Tag, Typography } from 'antd';

const { Text, Link } = Typography;

export interface ProgramTeamPerson {
  id: string;
  fullName: string;
  title: string | null;
  organization: string | null;
  role: string | null;
  confidence: number;
  lastSeenAt: string;
  sourceCount: number;
}

export interface ProgramTeamPanelProps {
  personnel: ProgramTeamPerson[];
  loading?: boolean;
  estimatedTotal?: number;
  onViewAllSources?: () => void;
  onLinkCrmContact?: (personId: string) => void;
}

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

export function ProgramTeamPanel({
  personnel,
  loading = false,
  estimatedTotal,
  onViewAllSources,
  onLinkCrmContact,
}: ProgramTeamPanelProps) {
  if (loading) {
    return (
      <Card title="Program team">
        <Skeleton active paragraph={{ rows: 5 }} />
      </Card>
    );
  }

  const total = estimatedTotal ?? personnel.length;

  return (
    <Card
      title="Program team"
      extra={
        <Space size={12}>
          <Text type="secondary">{personnel.length} of ~{total} known</Text>
          <Link onClick={onViewAllSources}>View all sources →</Link>
        </Space>
      }
    >
      {personnel.length === 0 ? (
        <Empty description="No team data found for this PE — log meeting contacts to build coverage" />
      ) : (
        <List
          dataSource={personnel}
          rowKey={(p) => p.id}
          renderItem={(person) => {
            const band = confidenceBand(person.confidence);
            return (
              <List.Item
                actions={[
                  <Button key="link" size="small" onClick={() => onLinkCrmContact?.(person.id)}>
                    Link
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={<Avatar>{initials(person.fullName)}</Avatar>}
                  title={
                    <Flex align="center" gap={8} wrap>
                      <Text strong>{person.fullName}</Text>
                      {person.role ? <Tag>{person.role}</Tag> : null}
                      <Tag color={band.color}>{band.label}</Tag>
                    </Flex>
                  }
                  description={
                    <Space direction="vertical" size={2}>
                      <Text type="secondary">
                        {[person.title, person.organization].filter(Boolean).join(' • ') || 'Title/organization unavailable'}
                      </Text>
                      <Text type="secondary">
                        Last seen {formatDate(person.lastSeenAt)} • {person.sourceCount} sources
                      </Text>
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
}

export function confidencePillColor(value: number): 'green' | 'gold' | 'default' {
  return confidenceBand(value).color;
}
