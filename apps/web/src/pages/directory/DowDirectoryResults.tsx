import { Avatar, Button, Card, Descriptions, Divider, Drawer, Empty, Flex, List, Pagination, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { BankOutlined, EnvironmentOutlined, LinkOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { AcquisitionPersonnelDetail, AcquisitionPersonnelListItem } from '../program-element/types.js';

const { Text, Link, Paragraph } = Typography;

// ── Shared helpers (self-contained; mirror ProgramTeamPanel conventions) ──────
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

// Service → tag color, for a consistent visual language across the directory.
const SERVICE_COLOR: Record<string, string> = {
  ARMY: 'green', NAVY: 'blue', AF: 'geekblue', SF: 'purple', USMC: 'red',
  OSD: 'volcano', DARPA: 'magenta', CONGRESS: 'gold',
};
function serviceColor(s: string | null): string {
  return (s && SERVICE_COLOR[s]) || 'default';
}

type PersonMetadata = {
  rank?: string | null;
  honorific?: string | null;
  paygrade?: string | null;
  dutyStation?: string | null;
  subOrganization?: string | null;
  directorySection?: string | null;
  directoryPage?: number | null;
  linkType?: string | null;
  programs?: string[] | null;
  sourcePdfVersion?: string | null;
};

function readMetadata(meta: unknown): PersonMetadata {
  if (meta && typeof meta === 'object') return meta as PersonMetadata;
  return {};
}

// Display name with rank/honorific prefix when available (standardized format).
function displayName(fullName: string, meta: PersonMetadata): string {
  const prefix = meta.rank || meta.honorific;
  if (prefix && !fullName.toUpperCase().startsWith(prefix.toUpperCase())) return `${prefix} ${fullName}`;
  return fullName;
}

// Where the person sits in the acquisition org tree (PAE → CPE/PEO → PM).
function orgPath(person: { organization: string | null }, meta: PersonMetadata): string {
  return [meta.subOrganization, person.organization].filter(Boolean).join('  ·  ') || '';
}

// ── List card: standardized person card (photo slot + name + role + PE + service) ──
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
          const peAligned = Boolean(person.pePrimary);
          return (
            <Card
              key={person.id}
              hoverable
              size="small"
              onClick={() => onSelectPerson(person.id)}
              style={{ cursor: 'pointer' }}
            >
              <Flex gap={12} align="flex-start">
                {/* Photo slot — falls back to initials until a headshot URL is wired. */}
                <Avatar size={48} style={{ flexShrink: 0, backgroundColor: '#1f3a5f' }}>
                  {initials(person.fullName)}
                </Avatar>
                <Space direction="vertical" size={2} style={{ flex: 1, minWidth: 0 }}>
                  <Flex align="center" gap={6} wrap>
                    <Text strong ellipsis style={{ maxWidth: '100%' }}>
                      {person.fullName}
                    </Text>
                    {person.role ? <Tag bordered={false}>{person.role}</Tag> : null}
                  </Flex>
                  <Text type="secondary" ellipsis>
                    {person.title || 'Title unavailable'}
                  </Text>
                  <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                    {person.organization || '—'}
                  </Text>
                  <Flex align="center" gap={6} wrap style={{ marginTop: 4 }}>
                    {person.service ? (
                      <Tag color={serviceColor(person.service)} bordered={false}>
                        {person.service}
                      </Tag>
                    ) : null}
                    {peAligned ? (
                      <Tag color="cyan" bordered={false}>
                        PE {person.pePrimary}
                      </Tag>
                    ) : (
                      <Tag bordered={false} style={{ opacity: 0.7 }}>
                        PE: unaligned
                      </Tag>
                    )}
                    <Tooltip title={`${person.sourceCount} source mention(s)`}>
                      <Tag color={band.color} bordered={false}>
                        {band.label}
                      </Tag>
                    </Tooltip>
                    {person.publicProfileUrl ? (
                      <Tooltip title="Has public profile (photo/bio)">
                        <LinkOutlined style={{ color: '#1677ff' }} />
                      </Tooltip>
                    ) : null}
                  </Flex>
                </Space>
              </Flex>
            </Card>
          );
        })}
      </div>
      {total > pageSize ? (
        <div className="directory-pagination">
          <Pagination current={page} pageSize={pageSize} total={total} onChange={onPage} showSizeChanger={false} />
        </div>
      ) : null}
    </>
  );
}

// ── Detail drawer: standardized profile (photo • details • org chart • PE • sources) ──
export interface DowPersonDrawerProps {
  open: boolean;
  person: AcquisitionPersonnelDetail | null;
  loading?: boolean;
  onClose: () => void;
}

export function DowPersonDrawer({ open, person, loading = false, onClose }: DowPersonDrawerProps) {
  const meta = readMetadata(person?.metadata);
  const programsFromPor = (person?.programOfRecord ?? '')
    .split('|')[0]!
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const metaPrograms = (meta.programs ?? []).filter(Boolean);
  const programList = metaPrograms.length ? metaPrograms : programsFromPor;
  const peCodes = person ? [person.pePrimary, ...(person.peSecondary ?? [])].filter(Boolean) : [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      title={person ? displayName(person.fullName, meta) : 'Personnel detail'}
      destroyOnClose
    >
      {loading || !person ? (
        <Spin />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* Header: photo + identity */}
          <Flex gap={16} align="flex-start">
            <Avatar
              size={72}
              src={undefined /* headshot URL slot — wired when asset pipeline lands */}
              style={{ flexShrink: 0, backgroundColor: '#1f3a5f', fontSize: 24 }}
            >
              {initials(person.fullName)}
            </Avatar>
            <Space direction="vertical" size={2} style={{ flex: 1, minWidth: 0 }}>
              {person.title ? <Text strong>{person.title}</Text> : null}
              {orgPath(person, meta) ? (
                <Text type="secondary">
                  <BankOutlined /> {orgPath(person, meta)}
                </Text>
              ) : null}
              {meta.dutyStation ? (
                <Text type="secondary">
                  <EnvironmentOutlined /> {meta.dutyStation}
                </Text>
              ) : null}
              <Flex gap={6} wrap style={{ marginTop: 6 }}>
                {person.service ? <Tag color={serviceColor(person.service)}>{person.service}</Tag> : null}
                {person.role ? <Tag>{person.role}</Tag> : null}
                {meta.paygrade ? <Tag>{meta.paygrade}</Tag> : null}
                <Tag color={confidenceBand(person.confidence).color}>
                  {confidenceBand(person.confidence).label} confidence
                </Tag>
                {person.status && person.status !== 'active' ? <Tag color="orange">{person.status}</Tag> : null}
              </Flex>
              {person.publicProfileUrl ? (
                <Button
                  type="link"
                  size="small"
                  icon={<LinkOutlined />}
                  href={person.publicProfileUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ paddingLeft: 0, marginTop: 4 }}
                >
                  View profile &amp; photo
                  {meta.linkType ? ` (${meta.linkType.replace('_', ' ')})` : ''}
                </Button>
              ) : null}
            </Space>
          </Flex>

          {/* PE alignment — the join to Program Element watch */}
          <div>
            <Text strong>
              <SafetyCertificateOutlined /> Program Element alignment
            </Text>
            <div style={{ marginTop: 8 }}>
              {peCodes.length ? (
                <Flex gap={6} wrap>
                  {peCodes.map((pe) => (
                    <Tag color="cyan" key={pe}>
                      <Link href={`/program-elements/${pe}`}>{pe}</Link>
                    </Tag>
                  ))}
                </Flex>
              ) : (
                <Text type="secondary">
                  No confirmed PE yet. {programList.length ? 'Program signal present — pending review-queue match.' : 'No program signal in source.'}
                </Text>
              )}
            </div>
          </div>

          {/* Programs owned (the PE bridge) */}
          {programList.length ? (
            <div>
              <Text strong>Programs</Text>
              <Flex gap={6} wrap style={{ marginTop: 8 }}>
                {programList.map((p) => (
                  <Tag key={p}>{p}</Tag>
                ))}
              </Flex>
            </div>
          ) : null}

          {/* Org chart slot — directory page reference; image renders when assets are served */}
          {meta.directorySection || meta.directoryPage ? (
            <div>
              <Text strong>Organization chart</Text>
              <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                {meta.directorySection ? <span>{meta.directorySection}</span> : null}
                {meta.directoryPage ? (
                  <span style={{ display: 'block' }}>DoW Directory Rev 6 · page {meta.directoryPage}</span>
                ) : null}
              </Paragraph>
            </div>
          ) : null}

          <Divider style={{ margin: '4px 0' }} />

          {/* Provenance */}
          <div>
            <Descriptions size="small" column={1} colon={false}>
              <Descriptions.Item label="First seen">{formatDate(person.firstSeenAt)}</Descriptions.Item>
              <Descriptions.Item label="Last seen">{formatDate(person.lastSeenAt)}</Descriptions.Item>
              {person.emailDomain ? (
                <Descriptions.Item label="Email domain">{person.emailDomain}</Descriptions.Item>
              ) : null}
            </Descriptions>
          </div>

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
