import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Divider,
  Input,
  Pagination,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { LinkOutlined, MailOutlined, DownloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import { type Chamber, type DirectoryApiResponse, type DirectoryEntry } from './directoryData.js';

type ChamberFilter = Chamber | 'All';
type RegionFilter = DirectoryEntry['region'] | 'All';
type SortOption = 'recent' | 'name-asc' | 'name-desc' | 'state-asc';

interface DirectoryPreset {
  name: string;
  query: string;
  chamber: ChamberFilter;
  region: RegionFilter;
  state: string;
  sort: SortOption;
}

interface DirectoryEntryOverride {
  owner?: string;
  notes?: string;
}

const chamberOptions: ChamberFilter[] = ['All', 'House', 'Senate', 'Governor'];
const regionOptions: RegionFilter[] = ['All', 'Northeast', 'South', 'Midwest', 'West'];
const PAGE_SIZE = 25;
const PRESET_STORAGE_KEY = 'capiro-directory-presets';
const DIRECTORY_OVERRIDE_STORAGE_KEY = 'capiro-directory-overrides';
const VALID_SORTS: SortOption[] = ['recent', 'name-asc', 'name-desc', 'state-asc'];

function getPartyColor(party: DirectoryEntry['party']): string {
  if (party === 'D') return 'blue';
  if (party === 'R') return 'red';
  return 'purple';
}

function getRelationshipColor(tier: DirectoryEntry['relationshipTier']): string {
  if (tier === 'Core') return 'gold';
  if (tier === 'Active') return 'green';
  return 'default';
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function readPresets(): DirectoryPreset[] {
  if (typeof window === 'undefined') return [];

  const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as DirectoryPreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readOverrides(): Record<string, DirectoryEntryOverride> {
  if (typeof window === 'undefined') return {};

  const raw = window.localStorage.getItem(DIRECTORY_OVERRIDE_STORAGE_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, DirectoryEntryOverride>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function buildApiParams(filters: {
  query: string;
  chamber: ChamberFilter;
  region: RegionFilter;
  state: string;
  sort: SortOption;
  page: number;
  pageSize: number;
}) {
  const params: Record<string, string | number> = {
    page: filters.page,
    pageSize: filters.pageSize,
    sort: filters.sort,
  };

  if (filters.query) params.q = filters.query;
  if (filters.chamber !== 'All') params.chamber = filters.chamber;
  if (filters.region !== 'All') params.region = filters.region;
  if (filters.state !== 'All') params.state = filters.state;

  return params;
}

function getSearchParamsFromFilters(filters: {
  query: string;
  chamber: ChamberFilter;
  region: RegionFilter;
  state: string;
  sort: SortOption;
  page: number;
}): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.query) params.set('q', filters.query);
  if (filters.chamber !== 'All') params.set('chamber', filters.chamber);
  if (filters.region !== 'All') params.set('region', filters.region);
  if (filters.state !== 'All') params.set('state', filters.state);
  if (filters.sort !== 'recent') params.set('sort', filters.sort);
  if (filters.page > 1) params.set('page', String(filters.page));

  return params;
}

function buildCsv(entries: DirectoryEntry[]): string {
  const header = [
    'Full Name',
    'Title',
    'Office',
    'Chamber',
    'State',
    'Party',
    'Region',
    'Focus Areas',
    'Phone',
    'Email',
    'Last Touchpoint',
  ];

  const rows = entries.map((entry) => [
    entry.fullName,
    entry.title,
    entry.office,
    entry.chamber,
    entry.state,
    entry.party,
    entry.region,
    entry.focusAreas.join('; '),
    entry.phone,
    entry.email,
    entry.lastTouchpoint,
  ]);

  return [header, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export function DirectoryPage() {
  const { TextArea } = Input;
  const { message } = App.useApp();
  const api = useApi();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState('');
  const [chamber, setChamber] = useState<ChamberFilter>('All');
  const [region, setRegion] = useState<RegionFilter>('All');
  const [state, setState] = useState<string>('All');
  const [sort, setSort] = useState<SortOption>('recent');
  const [page, setPage] = useState(1);
  const [presetName, setPresetName] = useState('');
  const [presets, setPresets] = useState<DirectoryPreset[]>(() => readPresets());
  const [overrides, setOverrides] = useState<Record<string, DirectoryEntryOverride>>(() => readOverrides());
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const directoryQuery = useQuery({
    queryKey: ['directory-contacts', query, chamber, region, state, sort, page],
    queryFn: async () =>
      (
        await api.get<DirectoryApiResponse>('/api/directory/contacts', {
          params: buildApiParams({
            query,
            chamber,
            region,
            state,
            sort,
            page,
            pageSize: PAGE_SIZE,
          }),
        })
      ).data,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const baseEntries = directoryQuery.data?.contacts ?? [];
  const totalFiltered = directoryQuery.data?.total ?? 0;
  const totals =
    directoryQuery.data?.totals ??
    ({ all: 0, house: 0, senate: 0, governors: 0 } as const);

  const mergedEntries = useMemo(
    () =>
      baseEntries.map((entry) => ({
        ...entry,
        ...overrides[entry.id],
      })),
    [baseEntries, overrides],
  );

  const stateOptions = directoryQuery.data?.availableStates ?? [];

  const ownerOptions = useMemo(
    () => Array.from(new Set(mergedEntries.map((entry) => entry.owner).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [mergedEntries],
  );

  const selectedEntry = useMemo(
    () => mergedEntries.find((entry) => entry.id === selectedEntryId) ?? null,
    [mergedEntries, selectedEntryId],
  );

  useEffect(() => {
    if (selectedEntryId && !selectedEntry) setSelectedEntryId(null);
  }, [selectedEntry, selectedEntryId]);

  useEffect(() => {
    const nextQuery = searchParams.get('q') ?? '';
    const nextChamber = (searchParams.get('chamber') as ChamberFilter | null) ?? 'All';
    const nextRegion = (searchParams.get('region') as RegionFilter | null) ?? 'All';
    const nextState = searchParams.get('state') ?? 'All';
    const nextSortRaw = searchParams.get('sort');
    const nextSort = VALID_SORTS.includes(nextSortRaw as SortOption) ? (nextSortRaw as SortOption) : 'recent';
    const pageParam = Number(searchParams.get('page') ?? '1');

    setQuery(nextQuery);
    setChamber(chamberOptions.includes(nextChamber) ? nextChamber : 'All');
    setRegion(regionOptions.includes(nextRegion) ? nextRegion : 'All');
    setState(nextState || 'All');
    setSort(nextSort);
    setPage(Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1);
  }, [searchParams]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
    if (page > maxPage) setPage(maxPage);
  }, [page, totalFiltered]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
  }, [presets]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DIRECTORY_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
  }, [overrides]);

  useEffect(() => {
    const nextParams = getSearchParamsFromFilters({ query, chamber, region, state, sort, page });
    const current = searchParams.toString();
    const next = nextParams.toString();
    if (current !== next) setSearchParams(nextParams, { replace: true });
  }, [chamber, page, query, region, searchParams, setSearchParams, sort, state]);

  function resetFilters() {
    setQuery('');
    setChamber('All');
    setRegion('All');
    setState('All');
    setSort('recent');
    setPage(1);
  }

  function savePreset() {
    const trimmed = presetName.trim();
    if (!trimmed) return;

    const nextPreset: DirectoryPreset = { name: trimmed, query, chamber, region, state, sort };

    setPresets((current) => {
      const filteredCurrent = current.filter((preset) => preset.name !== trimmed);
      return [nextPreset, ...filteredCurrent].slice(0, 8);
    });

    setPresetName('');
  }

  function applyPreset(preset: DirectoryPreset) {
    setQuery(preset.query);
    setChamber(preset.chamber);
    setRegion(preset.region);
    setState(preset.state);
    setSort(preset.sort);
    setPage(1);
  }

  function deletePreset(name: string) {
    setPresets((current) => current.filter((preset) => preset.name !== name));
  }

  function updateEntryOverride(entryId: string, patch: DirectoryEntryOverride) {
    setOverrides((current) => ({
      ...current,
      [entryId]: {
        ...current[entryId],
        ...patch,
      },
    }));
  }

  async function fetchAllFilteredContacts(): Promise<DirectoryEntry[]> {
    const allEntries: DirectoryEntry[] = [];
    let nextPage = 1;
    let total = 0;
    const exportPageSize = 1000;

    do {
      const response = await api.get<DirectoryApiResponse>('/api/directory/contacts', {
        params: buildApiParams({
          query,
          chamber,
          region,
          state,
          sort,
          page: nextPage,
          pageSize: exportPageSize,
        }),
      });
      allEntries.push(...response.data.contacts);
      total = response.data.total;
      nextPage += 1;
      if (response.data.contacts.length === 0) break;
    } while (allEntries.length < total);

    return allEntries;
  }

  async function copyFilteredEmails() {
    const allFiltered = await fetchAllFilteredContacts();
    const emails = allFiltered.map((entry) => entry.email).filter(Boolean).join('; ');
    if (!emails) {
      message.warning('No filtered emails available to copy.');
      return;
    }

    try {
      await navigator.clipboard.writeText(emails);
      message.success(`Copied ${allFiltered.length} email addresses.`);
    } catch {
      message.error('Clipboard copy failed in this browser context.');
    }
  }

  async function exportCsv() {
    const allFiltered = await fetchAllFilteredContacts();

    if (allFiltered.length === 0) {
      message.warning('No filtered contacts available to export.');
      return;
    }

    const blob = new Blob([buildCsv(allFiltered)], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = 'capiro-directory-export.csv';
    link.click();
    window.URL.revokeObjectURL(url);
    message.success(`Exported ${allFiltered.length} contacts to CSV.`);
  }

  async function copyShareLink() {
    const params = getSearchParamsFromFilters({ query, chamber, region, state, sort, page });
    const shareUrl = `${window.location.origin}${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      message.success('Copied shareable directory link.');
    } catch {
      message.error('Clipboard copy failed in this browser context.');
    }
  }

  async function copySingleEmail(email: string) {
    if (!email) {
      message.warning('No email on this contact.');
      return;
    }

    try {
      await navigator.clipboard.writeText(email);
      message.success('Copied contact email.');
    } catch {
      message.error('Clipboard copy failed in this browser context.');
    }
  }

  if (directoryQuery.isLoading) {
    return (
      <Card>
        <Space>
          <Spin />
          <Typography.Text>Loading real directory contacts...</Typography.Text>
        </Space>
      </Card>
    );
  }

  if (directoryQuery.isError) {
    return (
      <Alert
        type="error"
        message="Unable to load directory contacts"
        description={(directoryQuery.error as Error).message}
      />
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Typography.Text type="secondary">Total Contacts</Typography.Text>
            <Typography.Title level={3} style={{ margin: '6px 0 0' }}>
              {totals.all}
            </Typography.Title>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Typography.Text type="secondary">House</Typography.Text>
            <Typography.Title level={3} style={{ margin: '6px 0 0' }}>
              {totals.house}
            </Typography.Title>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Typography.Text type="secondary">Senate</Typography.Text>
            <Typography.Title level={3} style={{ margin: '6px 0 0' }}>
              {totals.senate}
            </Typography.Title>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Typography.Text type="secondary">Governor Offices</Typography.Text>
            <Typography.Title level={3} style={{ margin: '6px 0 0' }}>
              {totals.governors}
            </Typography.Title>
          </Card>
        </Col>
      </Row>

      <Card style={{ borderRadius: 14 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button icon={<MailOutlined />} onClick={copyFilteredEmails}>
            Copy filtered emails
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>
            Export CSV
          </Button>
          <Button icon={<LinkOutlined />} onClick={copyShareLink}>
            Copy share link
          </Button>
        </Space>

        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={12} lg={10}>
            <Input.Search
              allowClear
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search by name, title, office, policy area"
            />
          </Col>
          <Col xs={24} sm={8} md={4}>
            <Select
              value={chamber}
              onChange={(value) => {
                setChamber(value);
                setPage(1);
              }}
              style={{ width: '100%' }}
              options={chamberOptions.map((value) => ({ value, label: value }))}
            />
          </Col>
          <Col xs={24} sm={8} md={4}>
            <Select
              value={region}
              onChange={(value) => {
                setRegion(value);
                setPage(1);
              }}
              style={{ width: '100%' }}
              options={regionOptions.map((value) => ({ value, label: value }))}
            />
          </Col>
          <Col xs={24} sm={8} md={4}>
            <Select
              value={state}
              onChange={(value) => {
                setState(value);
                setPage(1);
              }}
              style={{ width: '100%' }}
              options={[
                { value: 'All', label: 'All states' },
                ...stateOptions.map((value) => ({ value, label: value })),
              ]}
            />
          </Col>
          <Col xs={24} md={2}>
            <Button block onClick={resetFilters}>
              Reset
            </Button>
          </Col>
        </Row>

        <Row gutter={[12, 12]} style={{ marginTop: 8 }} align="middle">
          <Col xs={24} md={8} lg={6}>
            <Select
              value={sort}
              onChange={(value) => {
                setSort(value);
                setPage(1);
              }}
              style={{ width: '100%' }}
              options={[
                { value: 'recent', label: 'Sort: recent touchpoint' },
                { value: 'name-asc', label: 'Sort: name A-Z' },
                { value: 'name-desc', label: 'Sort: name Z-A' },
                { value: 'state-asc', label: 'Sort: state' },
              ]}
            />
          </Col>
          <Col xs={24} md={16} lg={18}>
            <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space wrap>
                <Input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  onPressEnter={savePreset}
                  placeholder="Save current filters as..."
                  style={{ width: 220 }}
                />
                <Button type="primary" onClick={savePreset} disabled={presetName.trim().length === 0}>
                  Save preset
                </Button>
              </Space>
              <Space wrap>
                {presets.length === 0 ? (
                  <Typography.Text type="secondary">No saved presets yet</Typography.Text>
                ) : (
                  presets.map((preset) => (
                    <Tag
                      key={preset.name}
                      style={{ paddingInline: 10, lineHeight: '28px', borderRadius: 999 }}
                      closable
                      onClose={(event) => {
                        event.preventDefault();
                        deletePreset(preset.name);
                      }}
                    >
                      <a
                        onClick={(event) => {
                          event.preventDefault();
                          applyPreset(preset);
                        }}
                        href="/directory"
                        style={{ color: 'inherit' }}
                      >
                        {preset.name}
                      </a>
                    </Tag>
                  ))
                )}
              </Space>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card style={{ borderRadius: 14 }}>
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <Row justify="space-between" align="middle" gutter={[12, 12]}>
            <Col>
              <Typography.Text type="secondary">
                Showing {totalFiltered === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, totalFiltered)} of {totalFiltered} contacts
              </Typography.Text>
            </Col>
            <Col>
              <Typography.Text type="secondary">Page size {PAGE_SIZE}</Typography.Text>
            </Col>
          </Row>
          <Divider style={{ margin: '12px 0' }} />

          <div className="directory-grid directory-grid--header">
            <div>Contact</div>
            <div>Office</div>
            <div>Coverage</div>
            <div>Reach</div>
            <div>Actions</div>
          </div>

          {mergedEntries.map((entry) => (
            <div key={entry.id} className="directory-grid directory-grid--row">
              <div>
                <Space align="start">
                  <Avatar src={entry.photoUrl || undefined} size={44} style={{ background: '#183D9E', fontWeight: 700 }}>
                    {initials(entry.fullName)}
                  </Avatar>
                  <Space direction="vertical" size={1}>
                    <Typography.Text strong style={{ fontSize: 16 }}>
                      {entry.fullName}
                    </Typography.Text>
                    <Typography.Text>{entry.title}</Typography.Text>
                    <Typography.Text type="secondary">
                      {entry.region} region · owner {entry.owner || 'Unassigned'}
                    </Typography.Text>
                  </Space>
                </Space>
              </div>
              <div>
                <Space direction="vertical" size={2}>
                  <Typography.Text>{entry.office}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {entry.memberName} · {entry.officeLocation}
                  </Typography.Text>
                </Space>
              </div>
              <div>
                <Space size={[4, 8]} wrap>
                  <Tag color="geekblue">{entry.chamber}</Tag>
                  <Tag color={getPartyColor(entry.party)}>{entry.party}</Tag>
                  <Tag>{entry.state}</Tag>
                  <Tag color={getRelationshipColor(entry.relationshipTier)}>{entry.relationshipTier}</Tag>
                  {entry.committees.slice(0, 1).map((committee) => (
                    <Tag key={`${entry.id}-${committee}`}>{committee}</Tag>
                  ))}
                  {entry.focusAreas.slice(0, 3).map((focus) => (
                    <Tag key={`${entry.id}-${focus}`}>{focus}</Tag>
                  ))}
                </Space>
              </div>
              <div>
                <Space direction="vertical" size={1}>
                  <Typography.Text style={{ fontSize: 12 }}>{entry.phone}</Typography.Text>
                  <Typography.Text style={{ fontSize: 12 }} copyable={{ text: entry.email }}>
                    {entry.email}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    last touchpoint {entry.lastTouchpoint}
                  </Typography.Text>
                </Space>
              </div>
              <div>
                <Space wrap>
                  <Button size="small" onClick={() => setSelectedEntryId(entry.id)}>
                    Open brief
                  </Button>
                  <Button size="small" type="text" onClick={() => copySingleEmail(entry.email)}>
                    Copy email
                  </Button>
                </Space>
              </div>
            </div>
          ))}

          {totalFiltered === 0 ? (
            <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
              No contacts match this filter set. Try broadening the query or load a saved preset.
            </Typography.Paragraph>
          ) : null}

          {totalFiltered > PAGE_SIZE ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16 }}>
              <Pagination
                current={page}
                pageSize={PAGE_SIZE}
                total={totalFiltered}
                onChange={(nextPage) => setPage(nextPage)}
                showSizeChanger={false}
              />
            </div>
          ) : null}
        </Space>
      </Card>

      <Drawer
        title={selectedEntry?.fullName}
        placement="right"
        width={420}
        open={selectedEntry !== null}
        onClose={() => setSelectedEntryId(null)}
      >
        {selectedEntry ? (
          <Space direction="vertical" size={16} style={{ display: 'flex' }}>
            <Space align="start" size={12}>
              <Avatar src={selectedEntry.photoUrl || undefined} size={64} style={{ background: '#183D9E' }}>
                {initials(selectedEntry.fullName)}
              </Avatar>
              <div>
                <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
                  {selectedEntry.title}
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                  {selectedEntry.office}
                </Typography.Paragraph>
                <Typography.Text type="secondary">{selectedEntry.memberName}</Typography.Text>
              </div>
            </Space>

            <Space wrap>
              <Tag color="geekblue">{selectedEntry.chamber}</Tag>
              <Tag color={getPartyColor(selectedEntry.party)}>{selectedEntry.party}</Tag>
              <Tag>{selectedEntry.state}</Tag>
              <Tag>{selectedEntry.region}</Tag>
              <Tag color={getRelationshipColor(selectedEntry.relationshipTier)}>{selectedEntry.relationshipTier}</Tag>
            </Space>

            <Card size="small" title="Relationship Brief">
              <Space direction="vertical" size={10} style={{ display: 'flex' }}>
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="Owner">{selectedEntry.owner || 'Unassigned'}</Descriptions.Item>
                  <Descriptions.Item label="Office Location">{selectedEntry.officeLocation}</Descriptions.Item>
                  <Descriptions.Item label="Committees">{selectedEntry.committees.join(', ') || 'N/A'}</Descriptions.Item>
                  <Descriptions.Item label="Last Touchpoint">{selectedEntry.lastTouchpoint}</Descriptions.Item>
                </Descriptions>
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  {selectedEntry.notes || 'No relationship notes captured yet.'}
                </Typography.Paragraph>
              </Space>
            </Card>

            <Card size="small" title="Edit Relationship">
              <Space direction="vertical" size={10} style={{ display: 'flex' }}>
                <div>
                  <Typography.Text type="secondary">Owner</Typography.Text>
                  <Select
                    value={selectedEntry.owner || 'Unassigned'}
                    style={{ width: '100%', marginTop: 8 }}
                    onChange={(value) => {
                      updateEntryOverride(selectedEntry.id, { owner: value });
                      message.success('Owner updated.');
                    }}
                    options={[
                      ...ownerOptions.map((owner) => ({ value: owner, label: owner })),
                      { value: 'Unassigned', label: 'Unassigned' },
                    ]}
                  />
                </div>
                <div>
                  <Typography.Text type="secondary">Relationship Notes</Typography.Text>
                  <TextArea
                    value={selectedEntry.notes}
                    rows={5}
                    style={{ marginTop: 8 }}
                    onChange={(event) => {
                      updateEntryOverride(selectedEntry.id, { notes: event.target.value });
                    }}
                    placeholder="Capture operating style, policy posture, and follow-up guidance"
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Notes save locally in this browser local storage layer.
                  </Typography.Text>
                </div>
              </Space>
            </Card>

            <Card size="small" title="Contact">
              <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                <Typography.Text copyable={{ text: selectedEntry.email }}>{selectedEntry.email || 'N/A'}</Typography.Text>
                <Typography.Text copyable={{ text: selectedEntry.phone }}>{selectedEntry.phone || 'N/A'}</Typography.Text>
                <Typography.Text type="secondary">Last touchpoint: {selectedEntry.lastTouchpoint}</Typography.Text>
              </Space>
            </Card>

            <Card size="small" title="Policy Coverage">
              <Space direction="vertical" size={10} style={{ display: 'flex' }}>
                <div>
                  <Typography.Text type="secondary">Focus Areas</Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    <Space wrap>
                      {selectedEntry.focusAreas.length > 0 ? (
                        selectedEntry.focusAreas.map((focus) => (
                          <Tag key={`${selectedEntry.id}-drawer-focus-${focus}`}>{focus}</Tag>
                        ))
                      ) : (
                        <Typography.Text type="secondary">No focus areas listed</Typography.Text>
                      )}
                    </Space>
                  </div>
                </div>
                <div>
                  <Typography.Text type="secondary">Committees and Working Groups</Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    <Space wrap>
                      {selectedEntry.committees.length > 0 ? (
                        selectedEntry.committees.map((committee) => (
                          <Tag key={`${selectedEntry.id}-drawer-committee-${committee}`} color="blue">
                            {committee}
                          </Tag>
                        ))
                      ) : (
                        <Typography.Text type="secondary">No committees listed</Typography.Text>
                      )}
                    </Space>
                  </div>
                </div>
              </Space>
            </Card>

            <Card size="small" title="Recent Interactions">
              <Space direction="vertical" size={12} style={{ display: 'flex' }}>
                {selectedEntry.recentInteractions.length > 0 ? (
                  selectedEntry.recentInteractions.map((interaction) => (
                    <div key={`${selectedEntry.id}-${interaction.date}-${interaction.channel}`}>
                      <Space wrap size={[8, 8]}>
                        <Tag color="geekblue">{interaction.channel}</Tag>
                        <Typography.Text type="secondary">{interaction.date}</Typography.Text>
                      </Space>
                      <Typography.Paragraph style={{ margin: '6px 0 0' }}>
                        {interaction.summary}
                      </Typography.Paragraph>
                    </div>
                  ))
                ) : (
                  <Typography.Text type="secondary">No interaction logs available for this contact yet.</Typography.Text>
                )}
              </Space>
            </Card>

            <Card size="small" title="Quick Actions">
              <Space wrap>
                <Button icon={<MailOutlined />} onClick={() => copySingleEmail(selectedEntry.email)}>
                  Copy email
                </Button>
                <Button icon={<LinkOutlined />} onClick={copyShareLink}>
                  Copy filtered link
                </Button>
              </Space>
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
