import { useMemo, useState } from 'react';
import { Avatar, Card, Empty, Flex, List, Segmented, Select, Skeleton, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import { getAcquisitionPersonnel } from '../program-element/api.js';
import type { AcquisitionPersonnelListItem } from '../program-element/types.js';

const { Text } = Typography;

// Self-contained copies of the ProgramTeamPanel helpers (kept local so this tab has
// no cross-page coupling).
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

type ConfidenceBand = 'high' | 'medium' | 'low';

function confidenceBand(value: number): { label: ConfidenceBand; color: 'green' | 'gold' | 'default' } {
  if (value >= 0.95) return { label: 'high', color: 'green' };
  if (value >= 0.8) return { label: 'medium', color: 'gold' };
  return { label: 'low', color: 'default' };
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface DowDirectoryTabCapability {
  // Only the Program Element number is used by this tab; capabilities carry other fields we ignore.
  peNumber?: string | null;
}

export interface DowDirectoryTabProps {
  client: { id: string };
  capabilities: DowDirectoryTabCapability[];
  onSelectPerson?: (id: string) => void;
}

type ServiceFilter = string | 'all';
type RoleFilter = string | 'all';
type ConfidenceFilter = ConfidenceBand | 'all';

const ROLE_OPTIONS = ['PEO', 'PM', 'PCO', 'KO'];

export function DowDirectoryTab({ client, capabilities, onSelectPerson }: DowDirectoryTabProps) {
  const api = useApi();

  const peCodes = useMemo(
    () =>
      Array.from(
        new Set(
          capabilities
            .map((c) => (c.peNumber ?? '').trim().toUpperCase())
            .filter((code) => code.length > 0),
        ),
      ).sort(),
    [capabilities],
  );

  const [service, setService] = useState<ServiceFilter>('all');
  const [role, setRole] = useState<RoleFilter>('all');
  const [confidence, setConfidence] = useState<ConfidenceFilter>('all');

  // One API call per PE code (the endpoint takes a single pe_code); merge + dedupe by id.
  const personnelQuery = useQuery({
    queryKey: ['client-dow-directory', client.id, peCodes],
    enabled: peCodes.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const responses = await Promise.all(
        peCodes.map((peCode) => getAcquisitionPersonnel(api, { pe_code: peCode, limit: 100 })),
      );
      const byId = new Map<string, AcquisitionPersonnelListItem>();
      for (const resp of responses) {
        for (const person of resp.data) {
          if (!byId.has(person.id)) byId.set(person.id, person);
        }
      }
      return Array.from(byId.values());
    },
  });

  const allPeople = personnelQuery.data ?? [];

  const services = useMemo(
    () => Array.from(new Set(allPeople.map((p) => p.service).filter((s): s is string => !!s))).sort(),
    [allPeople],
  );

  const filtered = useMemo(
    () =>
      allPeople.filter((p) => {
        if (service !== 'all' && p.service !== service) return false;
        if (role !== 'all' && p.role !== role) return false;
        if (confidence !== 'all' && confidenceBand(p.confidence).label !== confidence) return false;
        return true;
      }),
    [allPeople, service, role, confidence],
  );

  if (peCodes.length === 0) {
    return (
      <Card title="DoW Directory">
        <Empty description="No defense program capabilities linked to this client yet" />
      </Card>
    );
  }

  return (
    <Card
      title="DoW Directory"
      extra={
        <Text type="secondary">
          {filtered.length} of {allPeople.length} known
        </Text>
      }
    >
      <Flex gap={12} wrap style={{ marginBottom: 16 }} aria-label="DoW directory filters">
        <Select<ServiceFilter>
          value={service}
          style={{ minWidth: 140 }}
          onChange={setService}
          options={[{ value: 'all', label: 'All services' }, ...services.map((s) => ({ value: s, label: s }))]}
        />
        <Select<RoleFilter>
          value={role}
          style={{ minWidth: 120 }}
          onChange={setRole}
          options={[{ value: 'all', label: 'All roles' }, ...ROLE_OPTIONS.map((r) => ({ value: r, label: r }))]}
        />
        <Segmented<ConfidenceFilter>
          value={confidence}
          onChange={(v) => setConfidence(v as ConfidenceFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ]}
        />
      </Flex>

      {personnelQuery.isLoading ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : filtered.length === 0 ? (
        <Empty description="No personnel match these filters" />
      ) : (
        <List
          dataSource={filtered}
          rowKey={(p) => p.id}
          renderItem={(person) => {
            const band = confidenceBand(person.confidence);
            return (
              <List.Item
                style={onSelectPerson ? { cursor: 'pointer' } : undefined}
                onClick={onSelectPerson ? () => onSelectPerson(person.id) : undefined}
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
                        {[person.title, person.organization].filter(Boolean).join(' • ') ||
                          'Title/organization unavailable'}
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
