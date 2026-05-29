// Step 3, Recipients picker.
//
// Branches on wizard direction:
//   • on-behalf  → search the Congressional Directory (Hill/agency contacts).
//                  Reuses /api/directory/contacts (same endpoint the v1
//                  RecipientSelect uses) for parity. Manual-add is the
//                  fallback for people not in the directory.
//   • to-clients → grouped picker over the user's portfolio clients, listing
//                  each client's `ClientPerson` rows via
//                  /api/clients/:clientId/people. Same "select-all per client"
//                  affordance the mockup specifies.
//
// In both cases the chip strip at the top mirrors the mockup's chip rail
// and lets the user drop selections without leaving the table.

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { SearchOutlined, UserAddOutlined } from '@ant-design/icons';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { useApi } from '../../../../lib/use-api.js';
import type {
  DirectoryApiResponse,
  DirectoryEntry,
} from '../../../directory/directoryData.js';
import type { Client } from '../../../clients/clientTypes.js';
import type { OutreachRecipient } from '../../OutreachView.js';
import { recipientKey, type WizardDirection } from './types.js';

interface Props {
  direction: WizardDirection;
  clients: Client[];
  selectedClientId: string | null;
  recipients: OutreachRecipient[];
  onChange: (next: OutreachRecipient[]) => void;
}

const PARTY_COLORS: Record<string, string> = {
  Democratic: 'blue',
  Republican: 'red',
  Independent: 'purple',
};

// Strip the v1 component's identity transform out, the v2 wizard's
// `recipientKey()` is the canonical id chain so we keep one definition.
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

export function StepRecipients({
  direction,
  clients,
  selectedClientId,
  recipients,
  onChange,
}: Props) {
  const removeRecipient = (r: OutreachRecipient) => {
    const key = recipientKey(r);
    onChange(recipients.filter((x) => recipientKey(x) !== key));
  };

  return (
    <div>
      <h2>
        Select recipients
        {recipients.length > 0 && (
          <Badge
            count={recipients.length}
            style={{ backgroundColor: 'var(--ov2-accent-ink)', marginLeft: 8 }}
          />
        )}
      </h2>
      <div className="ov2-pane-sub">
        {direction === 'on-behalf'
          ? 'Choose congressional offices, staffers, or committee contacts to receive this campaign.'
          : 'Choose which client people from your portfolio should receive this briefing.'}
      </div>

      {/* Chip rail of current selections */}
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

      {direction === 'on-behalf' ? (
        <DirectoryAndManualPicker recipients={recipients} onChange={onChange} />
      ) : (
        <ClientPeoplePicker
          clients={clients}
          selectedClientId={selectedClientId}
          recipients={recipients}
          onChange={onChange}
        />
      )}
    </div>
  );
}

// ============================================================================
// On-behalf-of-client picker: Congressional directory + manual.
// Ported from steps/RecipientSelect.tsx with the chip rail factored out
// (now lives on the parent component above).
// ============================================================================

function DirectoryAndManualPicker({
  recipients,
  onChange,
}: {
  recipients: OutreachRecipient[];
  onChange: (next: OutreachRecipient[]) => void;
}) {
  const api = useApi();
  const [tab, setTab] = useState<'directory' | 'manual'>('directory');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [chamberFilter, setChamberFilter] = useState<string>('');
  const [manualInput, setManualInput] = useState('');
  const [queryTimer, setQueryTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const directory = useQuery<DirectoryApiResponse>({
    queryKey: ['outreach-v2-directory', debouncedQuery],
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
    () => Array.from(new Set(directoryRows.map((r) => r.state).filter(Boolean))).sort(),
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
          <div style={{ fontSize: 12, color: 'var(--ov2-ink-3)' }}>{entry.title}</div>
        </div>
      ),
    },
    { title: 'Office', dataIndex: 'office', key: 'office', ellipsis: true },
    {
      title: 'Committee',
      key: 'committee',
      render: (_: unknown, entry: DirectoryEntry) => entry.committees[0] ?? '-',
      ellipsis: true,
    },
    { title: 'State', dataIndex: 'state', key: 'state', width: 70 },
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
          '-'
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

  return (
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
                  pagination={{
                    pageSize: 20,
                    showSizeChanger: false,
                    showTotal: (t) => `${t} results`,
                  }}
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
  );
}

// ============================================================================
// To-clients picker: grouped per-client people lists.
// Calls /api/clients/:clientId/people for every visible client in parallel.
// Selecting a client header toggles all of its people; per-person checkboxes
// give fine-grained control.
// ============================================================================

interface ClientPerson {
  id: string;
  fullName: string;
  email: string | null;
  title: string | null;
  role: string | null;
  avatar?: string | null;
  color?: string | null;
}

function ClientPeoplePicker({
  clients,
  selectedClientId,
  recipients,
  onChange,
}: {
  clients: Client[];
  selectedClientId: string | null;
  recipients: OutreachRecipient[];
  onChange: (next: OutreachRecipient[]) => void;
}) {
  const api = useApi();

  // Show all clients by default; pre-expand the wizard's selected client.
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(selectedClientId ? [selectedClientId] : clients.slice(0, 3).map((c) => c.id)),
  );

  const peopleQueries = useQueries({
    queries: clients.map((c) => ({
      queryKey: ['outreach-v2-client-people', c.id],
      queryFn: async () =>
        (await api.get<{ people: ClientPerson[] } | ClientPerson[]>(`/api/clients/${c.id}/people`))
          .data,
      // Cache people across step navigations.
      staleTime: 60_000,
    })),
  });

  const peopleByClient = useMemo(() => {
    const map = new Map<string, ClientPerson[]>();
    clients.forEach((c, i) => {
      const result = peopleQueries[i]?.data;
      const list = Array.isArray(result) ? result : result?.people ?? [];
      map.set(c.id, list);
    });
    return map;
  }, [clients, peopleQueries]);

  const isOn = (clientId: string, personId: string): boolean =>
    recipients.some((r) => r.clientId === clientId && r.id === personId);

  const togglePerson = (client: Client, person: ClientPerson) => {
    if (isOn(client.id, person.id)) {
      onChange(recipients.filter((r) => !(r.clientId === client.id && r.id === person.id)));
      return;
    }
    const next: OutreachRecipient = {
      id: person.id,
      clientId: client.id,
      name: person.fullName,
      email: person.email ?? undefined,
      title: person.title ?? undefined,
      relevanceReason: `${client.name}, ${person.role ?? 'Contact'}`,
    };
    onChange([...recipients, next]);
  };

  const toggleAll = (client: Client) => {
    const people = peopleByClient.get(client.id) ?? [];
    if (people.length === 0) return;
    const allOn = people.every((p) => isOn(client.id, p.id));
    if (allOn) {
      onChange(recipients.filter((r) => r.clientId !== client.id));
      return;
    }
    const additions = people
      .filter((p) => !isOn(client.id, p.id))
      .map<OutreachRecipient>((p) => ({
        id: p.id,
        clientId: client.id,
        name: p.fullName,
        email: p.email ?? undefined,
        title: p.title ?? undefined,
        relevanceReason: `${client.name}, ${p.role ?? 'Contact'}`,
      }));
    onChange([...recipients, ...additions]);
  };

  const toggleExpand = (clientId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };

  if (clients.length === 0) {
    return <Empty description="No clients in your portfolio yet." />;
  }

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Recipients are pulled from each client's <b>People</b> tab. Toggle a client header to
        select everyone on that client, or pick individuals.
      </Typography.Paragraph>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {clients.map((c, i) => {
          const people = peopleByClient.get(c.id) ?? [];
          const selectedCount = people.filter((p) => isOn(c.id, p.id)).length;
          const allOn = people.length > 0 && selectedCount === people.length;
          const someOn = selectedCount > 0 && !allOn;
          const isOpen = expanded.has(c.id);
          const loading = peopleQueries[i]?.isLoading;

          return (
            <div
              key={c.id}
              style={{
                border: '1px solid var(--ov2-border-1)',
                borderRadius: 8,
                overflow: 'hidden',
                background: 'var(--ov2-bg-surface)',
              }}
            >
              <div
                style={{
                  background: 'var(--ov2-bg-surface-2)',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  borderBottom: isOpen && people.length > 0 ? '1px solid var(--ov2-border-1)' : 'none',
                }}
              >
                <Checkbox
                  checked={allOn}
                  indeterminate={someOn}
                  onChange={() => toggleAll(c)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div
                  onClick={() => toggleExpand(c.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: 'var(--ov2-bg-sunken)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--ov2-ink-2)',
                    }}
                  >
                    {c.name[0]}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ov2-ink-3)' }}>
                      {loading
                        ? 'Loading people…'
                        : `${people.length} ${people.length === 1 ? 'person' : 'people'}`}
                    </div>
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--ov2-ink-3)', fontWeight: 500 }}>
                    {selectedCount}/{people.length} selected
                  </span>
                </div>
              </div>

              {isOpen && people.length === 0 && !loading && (
                <div
                  style={{
                    padding: '14px 18px',
                    fontSize: 12,
                    color: 'var(--ov2-ink-3)',
                    fontStyle: 'italic',
                  }}
                >
                  No people on this client yet, add them on the client's Portfolio → People tab.
                </div>
              )}

              {isOpen &&
                people.map((p) => {
                  const on = isOn(c.id, p.id);
                  return (
                    <div
                      key={p.id}
                      onClick={() => togglePerson(c, p)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '24px 30px 1.4fr 1fr auto',
                        gap: 12,
                        alignItems: 'center',
                        padding: '10px 14px',
                        borderBottom: '1px solid var(--ov2-border-1)',
                        cursor: 'pointer',
                        background: on ? 'var(--ov2-accent-soft)' : 'var(--ov2-bg-surface)',
                      }}
                    >
                      <Checkbox checked={on} onClick={(e) => e.stopPropagation()} onChange={() => togglePerson(c, p)} />
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: p.color ?? 'var(--ov2-accent)',
                          color: '#fff',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {p.avatar || p.fullName.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.fullName}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ov2-ink-3)' }}>{p.title}</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ov2-ink-2)' }}>{p.email}</div>
                      {p.role && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: 4,
                            background:
                              p.role === 'Primary POC'
                                ? 'var(--ov2-accent-soft)'
                                : 'var(--ov2-bg-sunken)',
                            color:
                              p.role === 'Primary POC'
                                ? 'var(--ov2-accent-ink)'
                                : 'var(--ov2-ink-2)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                          }}
                        >
                          {p.role}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
