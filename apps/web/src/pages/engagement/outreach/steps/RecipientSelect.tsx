import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tabs,
  Typography,
} from 'antd';
import { SearchOutlined, UserAddOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { useApi } from '../../../../lib/use-api.js';
import type { DirectoryApiResponse, DirectoryEntry } from '../../../directory/directoryData.js';
import type { OutreachRecipient } from '../../OutreachView.js';

interface RecipientSelectProps {
  recipients: OutreachRecipient[];
  clientId: string | null;
  onChange: (recipients: OutreachRecipient[]) => void;
}

function recipientKey(r: OutreachRecipient): string {
  return r.directoryContactId || r.email?.toLowerCase() || r.name?.toLowerCase() || JSON.stringify(r);
}

function fromDirectoryEntry(entry: DirectoryEntry): OutreachRecipient {
  const address = entry.addresses.find((a) => a.isMain) ?? entry.addresses[0];
  const formattedAddress = address
    ? [address.address1, address.city, address.state, address.zip].filter(Boolean).join(', ')
    : entry.officeLocation;
  return {
    name: entry.fullName,
    email: entry.email || undefined,
    office: entry.office || undefined,
    title: entry.title || undefined,
    chamber: entry.chamber || undefined,
    state: entry.state || undefined,
    district: entry.district || undefined,
    party: entry.partyName || undefined,
    directoryContactId: entry.id,
    directoryContactName: entry.fullName,
    committee: entry.committees[0] || undefined,
    address: formattedAddress || undefined,
    relevanceReason: [entry.committees[0], entry.focusAreas[0]].filter(Boolean).join(' | '),
  };
}

const PARTY_COLORS: Record<string, string> = {
  Democratic: 'blue',
  Republican: 'red',
  Independent: 'purple',
};

export function RecipientSelect({ recipients, clientId, onChange }: RecipientSelectProps) {
  const api = useApi();
  const [tab, setTab] = useState<'directory' | 'manual'>('directory');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [chamberFilter, setChamberFilter] = useState<string>('');
  const [manualInput, setManualInput] = useState('');
  const [queryTimer, setQueryTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const directory = useQuery<DirectoryApiResponse>({
    queryKey: ['outreach-wizard-directory', debouncedQuery],
    queryFn: async () =>
      (
        await api.get<DirectoryApiResponse>('/api/directory/contacts', {
          params: { q: debouncedQuery, pageSize: 50 },
        })
      ).data,
    enabled: debouncedQuery.trim().length >= 2,
  });

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (queryTimer) clearTimeout(queryTimer);
    const timer = setTimeout(() => setDebouncedQuery(value), 400);
    setQueryTimer(timer);
  };

  const directoryRows = directory.data?.contacts ?? [];

  const filteredRows = useMemo(() => {
    let rows = directoryRows;
    if (stateFilter) rows = rows.filter((r) => r.state === stateFilter);
    if (chamberFilter) rows = rows.filter((r) => r.chamber === chamberFilter);
    return rows;
  }, [directoryRows, stateFilter, chamberFilter]);

  const states = useMemo(
    () =>
      Array.from(new Set(directoryRows.map((r) => r.state).filter(Boolean))).sort(),
    [directoryRows],
  );

  const selectedKeys = recipients
    .filter((r) => r.directoryContactId)
    .map((r) => r.directoryContactId as string);

  const columns: ColumnsType<DirectoryEntry> = [
    {
      title: 'Name',
      dataIndex: 'fullName',
      key: 'name',
      render: (name: string, entry) => (
        <div>
          <div style={{ fontWeight: 500 }}>{name}</div>
          <div style={{ fontSize: 12, color: '#888' }}>{entry.title}</div>
        </div>
      ),
    },
    {
      title: 'Office',
      dataIndex: 'office',
      key: 'office',
      ellipsis: true,
    },
    {
      title: 'Committee',
      key: 'committee',
      render: (_: unknown, entry: DirectoryEntry) => entry.committees[0] ?? '—',
      ellipsis: true,
    },
    {
      title: 'State',
      dataIndex: 'state',
      key: 'state',
      width: 70,
    },
    {
      title: 'Party',
      dataIndex: 'partyName',
      key: 'party',
      width: 110,
      render: (party: string) =>
        party ? (
          <Tag color={PARTY_COLORS[party] ?? 'default'} style={{ fontSize: 11 }}>
            {party}
          </Tag>
        ) : (
          '—'
        ),
    },
  ];

  const rowSelection = {
    selectedRowKeys: selectedKeys,
    onChange: (_: React.Key[], rows: DirectoryEntry[]) => {
      const directoryRecipients = rows.map(fromDirectoryEntry);
      const nonDirectoryRecipients = recipients.filter((r) => !r.directoryContactId);
      onChange([...nonDirectoryRecipients, ...directoryRecipients]);
    },
    getCheckboxProps: (record: DirectoryEntry) => ({ name: record.id }),
  };

  const addManual = () => {
    const text = manualInput.trim();
    if (!text) return;
    const angle = text.match(/^(.*)<([^>]+)>$/);
    const recipient: OutreachRecipient = angle
      ? { name: angle[1]?.trim(), email: angle[2]?.trim() }
      : text.includes('@')
        ? { email: text }
        : { name: text };
    const key = recipientKey(recipient);
    if (!recipients.some((r) => recipientKey(r) === key)) {
      onChange([...recipients, { ...recipient, relevanceReason: 'Manually added' }]);
    }
    setManualInput('');
  };

  const removeRecipient = (r: OutreachRecipient) => {
    const key = recipientKey(r);
    onChange(recipients.filter((existing) => recipientKey(existing) !== key));
  };

  return (
    <div className="outreach-flow-stack">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Select recipients
        </Typography.Title>
        {recipients.length > 0 && (
          <Badge count={recipients.length} style={{ backgroundColor: '#1c2e4a' }} />
        )}
      </div>

      {recipients.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Selected:
          </Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {recipients.map((r) => (
              <Tag
                key={recipientKey(r)}
                closable
                onClose={() => removeRecipient(r)}
                style={{ margin: 0 }}
              >
                {r.name || r.email || 'Recipient'}
              </Tag>
            ))}
          </div>
        </div>
      )}

      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as 'directory' | 'manual')}
        items={[
          {
            key: 'directory',
            label: 'Congressional Directory',
            children: (
              <div>
                <Space style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap' }}>
                  <Input
                    prefix={<SearchOutlined />}
                    placeholder="Search members and staffers..."
                    value={query}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    style={{ width: 280 }}
                    allowClear
                  />
                  <Select
                    placeholder="State"
                    allowClear
                    value={stateFilter || undefined}
                    onChange={(v) => setStateFilter(v ?? '')}
                    style={{ width: 100 }}
                    options={states.map((s) => ({ value: s, label: s }))}
                  />
                  <Select
                    placeholder="Chamber"
                    allowClear
                    value={chamberFilter || undefined}
                    onChange={(v) => setChamberFilter(v ?? '')}
                    style={{ width: 120 }}
                    options={[
                      { value: 'House', label: 'House' },
                      { value: 'Senate', label: 'Senate' },
                    ]}
                  />
                </Space>

                {debouncedQuery.trim().length < 2 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="Type at least 2 characters to search the congressional directory"
                  />
                ) : (
                  <Table<DirectoryEntry>
                    rowKey="id"
                    size="small"
                    loading={directory.isLoading}
                    dataSource={filteredRows}
                    columns={columns}
                    rowSelection={rowSelection}
                    pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `${t} results` }}
                    scroll={{ x: 600 }}
                  />
                )}
              </div>
            ),
          },
          {
            key: 'manual',
            label: 'Manual Add',
            children: (
              <div>
                <Typography.Paragraph type="secondary">
                  Add a recipient by name or email address. Format:{' '}
                  <code>Name &lt;email@example.com&gt;</code> or just an email.
                </Typography.Paragraph>
                <Space.Compact style={{ width: '100%', maxWidth: 480 }}>
                  <Input
                    prefix={<UserAddOutlined />}
                    value={manualInput}
                    placeholder="Name <email@example.com> or email@example.com"
                    onChange={(e) => setManualInput(e.target.value)}
                    onPressEnter={addManual}
                  />
                  <Button type="primary" onClick={addManual}>
                    Add
                  </Button>
                </Space.Compact>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
