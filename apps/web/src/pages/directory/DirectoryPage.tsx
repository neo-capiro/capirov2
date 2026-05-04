import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Pagination,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  CopyOutlined,
  LinkOutlined,
  MailOutlined,
  PhoneOutlined,
  SearchOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import {
  type DirectoryApiResponse,
  type DirectoryContactNote,
  type DirectoryEntry,
  type Party,
} from './directoryData.js';

type FreshmanFilter = 'All' | 'Freshman' | 'Non-Freshman';
type ChamberFilter = DirectoryEntry['chamber'] | 'All';
type GenderFilter = DirectoryEntry['gender'] | 'All';
type SortOption = 'recent' | 'name-asc' | 'name-desc' | 'state-asc';

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 300;
const emptyFilters = [] as string[];

function partyColor(party: Party): string {
  if (party === 'D') return 'blue';
  if (party === 'R') return 'red';
  return 'default';
}

function partyLabel(party: Party): string {
  if (party === 'D') return 'Democrat';
  if (party === 'R') return 'Republican';
  return 'Independent';
}

function genderLabel(gender: DirectoryEntry['gender']): string {
  if (gender === 'F') return 'Female';
  if (gender === 'M') return 'Male';
  return 'Unknown';
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function yearFromDate(date: string): string {
  if (!date) return 'Unknown';
  return date.slice(0, 4);
}

function formatNoteDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));
}

function noteAuthor(note: DirectoryContactNote): string {
  const fullName = [note.createdBy?.firstName, note.createdBy?.lastName].filter(Boolean).join(' ');
  return fullName || note.createdBy?.email || 'Former user';
}

function buildApiParams(filters: {
  query: string;
  freshman: FreshmanFilter;
  chamber: ChamberFilter;
  party: Party[];
  gender: GenderFilter;
  leadership: string[];
  caucus: string[];
  state: string[];
  district: string[];
  education: string[];
  sort: SortOption;
  page: number;
  pageSize: number;
}) {
  const params: Record<string, string | number> = {
    page: filters.page,
    pageSize: filters.pageSize,
    sort: filters.sort,
  };

  if (filters.query.trim()) params.q = filters.query.trim();
  if (filters.freshman !== 'All') params.freshman = filters.freshman;
  if (filters.chamber !== 'All') params.chamber = filters.chamber;
  if (filters.party.length > 0) params.party = filters.party.join(',');
  if (filters.gender !== 'All') params.gender = filters.gender;
  if (filters.leadership.length > 0) params.leadership = filters.leadership.join(',');
  if (filters.caucus.length > 0) params.caucus = filters.caucus.join(',');
  if (filters.state.length > 0) params.state = filters.state.join(',');
  if (filters.district.length > 0) params.district = filters.district.join(',');
  if (filters.education.length > 0) params.education = filters.education.join(',');

  return params;
}

interface FilterBlockProps {
  label: string;
  children: React.ReactNode;
}

function FilterBlock({ label, children }: FilterBlockProps) {
  return (
    <div className="directory-filter-block">
      <Typography.Text className="directory-filter-label">{label}</Typography.Text>
      {children}
    </div>
  );
}

export function DirectoryPage() {
  const { message } = App.useApp();
  const api = useApi();

  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [freshman, setFreshman] = useState<FreshmanFilter>('All');
  const [chamber, setChamber] = useState<ChamberFilter>('All');
  const [party, setParty] = useState<Party[]>([]);
  const [gender, setGender] = useState<GenderFilter>('All');
  const [leadership, setLeadership] = useState<string[]>([]);
  const [caucus, setCaucus] = useState<string[]>([]);
  const [state, setState] = useState<string[]>([]);
  const [district, setDistrict] = useState<string[]>([]);
  const [education, setEducation] = useState<string[]>([]);
  const [sort, setSort] = useState<SortOption>('recent');
  const [page, setPage] = useState(1);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQuery(searchText);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [searchText]);

  const directoryQuery = useQuery({
    queryKey: [
      'directory-contacts',
      query,
      freshman,
      chamber,
      party,
      gender,
      leadership,
      caucus,
      state,
      district,
      education,
      sort,
      page,
    ],
    queryFn: async () =>
      (
        await api.get<DirectoryApiResponse>('/api/directory/contacts', {
          params: buildApiParams({
            query,
            freshman,
            chamber,
            party,
            gender,
            leadership,
            caucus,
            state,
            district,
            education,
            sort,
            page,
            pageSize: PAGE_SIZE,
          }),
        })
      ).data,
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    retry: 1,
  });

  const entries = directoryQuery.data?.contacts ?? [];
  const totalFiltered = directoryQuery.data?.total ?? 0;
  const totals =
    directoryQuery.data?.totals ??
    ({
      all: 0,
      house: 0,
      senate: 0,
      governors: 0,
    } as const);
  const availableFilters = directoryQuery.data?.availableFilters;
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedEntryId) ?? null,
    [entries, selectedEntryId],
  );

  function resetFilters() {
    setSearchText('');
    setQuery('');
    setFreshman('All');
    setChamber('All');
    setParty([]);
    setGender('All');
    setLeadership([]);
    setCaucus([]);
    setState([]);
    setDistrict([]);
    setEducation([]);
    setSort('recent');
    setPage(1);
  }

  async function copyContact(value: string, label: string) {
    if (!value) {
      message.warning(`No ${label.toLowerCase()} on this profile.`);
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      message.success(`Copied ${label.toLowerCase()}.`);
    } catch {
      message.error('Clipboard copy failed in this browser context.');
    }
  }

  if (directoryQuery.isLoading && !directoryQuery.data) {
    return (
      <Card>
        <Space>
          <Spin />
          <Typography.Text>Loading directory people from source snapshots...</Typography.Text>
        </Space>
      </Card>
    );
  }

  if (directoryQuery.isError) {
    return (
      <Alert
        type="error"
        message="Unable to load directory"
        description={(directoryQuery.error as Error).message}
      />
    );
  }

  return (
    <div className="directory-page">
      <section className="directory-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Directory
          </Typography.Title>
        </div>
        <Select
          value={sort}
          onChange={(value) => {
            setSort(value);
            setPage(1);
          }}
          style={{ width: 220 }}
          options={[
            { value: 'recent', label: 'Recently updated' },
            { value: 'name-asc', label: 'Name A-Z' },
            { value: 'name-desc', label: 'Name Z-A' },
            { value: 'state-asc', label: 'State and district' },
          ]}
        />
      </section>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={6} xl={5}>
          <aside className="directory-filter-panel">
            <Radio.Group
              value={freshman}
              onChange={(event) => {
                setFreshman(event.target.value);
                setPage(1);
              }}
              className="directory-freshman-radio"
            >
              <Radio value="All">All</Radio>
              <Radio value="Freshman">Freshman</Radio>
              <Radio value="Non-Freshman">Non-Freshman</Radio>
            </Radio.Group>

            <FilterBlock label="Chamber">
              <Select
                value={chamber}
                onChange={(value) => {
                  setChamber(value);
                  setPage(1);
                }}
                options={[
                  { value: 'All', label: 'All' },
                  ...(availableFilters?.chambers ?? []).map((value) => ({ value, label: value })),
                ]}
              />
            </FilterBlock>

            <FilterBlock label="Party">
              <Select
                mode="multiple"
                value={party}
                onChange={(value) => {
                  setParty(value);
                  setPage(1);
                }}
                placeholder="Type or Select Parties"
                maxTagCount="responsive"
                options={(availableFilters?.parties ?? []).map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
            </FilterBlock>

            <FilterBlock label="Gender">
              <Select
                value={gender}
                onChange={(value) => {
                  setGender(value);
                  setPage(1);
                }}
                options={[
                  { value: 'All', label: 'All' },
                  ...(availableFilters?.genders ?? []).map((option) => ({
                    value: option.value,
                    label: option.label,
                  })),
                ]}
              />
            </FilterBlock>

            <FilterBlock label="Leadership">
              <Select
                mode="multiple"
                value={leadership}
                onChange={(value) => {
                  setLeadership(value);
                  setPage(1);
                }}
                placeholder="Select Leadership Position(s)"
                maxTagCount="responsive"
                options={(availableFilters?.leadership ?? emptyFilters).map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </FilterBlock>

            <FilterBlock label="Caucus">
              <Select
                mode="multiple"
                value={caucus}
                onChange={(value) => {
                  setCaucus(value);
                  setPage(1);
                }}
                placeholder={
                  (availableFilters?.caucuses.length ?? 0) > 0
                    ? 'Type or Select Caucuses'
                    : 'No caucus data in source'
                }
                disabled={(availableFilters?.caucuses.length ?? 0) === 0}
                maxTagCount="responsive"
                options={(availableFilters?.caucuses ?? emptyFilters).map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </FilterBlock>

            <FilterBlock label="State">
              <Select
                mode="multiple"
                value={state}
                onChange={(value) => {
                  setState(value);
                  setPage(1);
                }}
                placeholder="Type or Select State(s)"
                maxTagCount="responsive"
                options={(availableFilters?.states ?? emptyFilters).map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </FilterBlock>

            <FilterBlock label="District">
              <Select
                mode="multiple"
                value={district}
                onChange={(value) => {
                  setDistrict(value);
                  setPage(1);
                }}
                placeholder="Type or Select District(s)"
                maxTagCount="responsive"
                options={(availableFilters?.districts ?? emptyFilters).map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </FilterBlock>

            <FilterBlock label="Educational Institution">
              <Select
                mode="multiple"
                value={education}
                onChange={(value) => {
                  setEducation(value);
                  setPage(1);
                }}
                placeholder={
                  (availableFilters?.educationInstitutions.length ?? 0) > 0
                    ? 'Select Educational Institution(s)'
                    : 'No education data in source'
                }
                disabled={(availableFilters?.educationInstitutions.length ?? 0) === 0}
                maxTagCount="responsive"
                options={(availableFilters?.educationInstitutions ?? emptyFilters).map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </FilterBlock>

            <Button className="directory-reset-button" block onClick={resetFilters}>
              Reset Filters
            </Button>
          </aside>
        </Col>

        <Col xs={24} lg={18} xl={19}>
          <Space direction="vertical" size={16} style={{ display: 'flex' }}>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}>
                <Card className="directory-stat-card">
                  <Typography.Text type="secondary">All people</Typography.Text>
                  <Typography.Title level={4}>{totals.all}</Typography.Title>
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card className="directory-stat-card">
                  <Typography.Text type="secondary">House</Typography.Text>
                  <Typography.Title level={4}>{totals.house}</Typography.Title>
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card className="directory-stat-card">
                  <Typography.Text type="secondary">Senate</Typography.Text>
                  <Typography.Title level={4}>{totals.senate}</Typography.Title>
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card className="directory-stat-card">
                  <Typography.Text type="secondary">Governors</Typography.Text>
                  <Typography.Title level={4}>{totals.governors}</Typography.Title>
                </Card>
              </Col>
            </Row>

            <div className="directory-search-row">
              <Input
                allowClear
                size="large"
                prefix={<SearchOutlined />}
                suffix={directoryQuery.isFetching ? <Spin size="small" /> : null}
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                }}
                onPressEnter={() => {
                  setQuery(searchText);
                  setPage(1);
                }}
                placeholder="Search by name, office, committee, staff, phone, or email"
              />
              <Typography.Text type="secondary">
                Showing {totalFiltered === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}-
                {Math.min(page * PAGE_SIZE, totalFiltered)} of {totalFiltered}
              </Typography.Text>
            </div>

            {entries.length === 0 ? (
              <Card>
                <Empty description="No people match these filters" />
              </Card>
            ) : (
              <div className="directory-card-grid">
                {entries.map((entry) => (
                  <article
                    key={entry.id}
                    className="directory-person-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedEntryId(entry.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedEntryId(entry.id);
                      }
                    }}
                  >
                    <div className="directory-person-topline">
                      <Avatar
                        src={entry.photoUrl || undefined}
                        size={58}
                        className="directory-person-avatar"
                      >
                        {initials(entry.memberName)}
                      </Avatar>
                      <div className="directory-person-title">
                        <Typography.Text strong>{entry.fullName}</Typography.Text>
                        <Typography.Text type="secondary">{entry.title}</Typography.Text>
                      </div>
                    </div>

                    <Space size={[6, 6]} wrap className="directory-card-tags">
                      <Tag color="geekblue">{entry.chamber}</Tag>
                      <Tag color={partyColor(entry.party)}>{entry.party}</Tag>
                      <Tag>{entry.district}</Tag>
                      {entry.isFreshman ? <Tag color="green">Freshman</Tag> : null}
                    </Space>

                    <div className="directory-card-office">
                      <Typography.Text>{entry.office}</Typography.Text>
                      <Typography.Text type="secondary">
                        Serving since {yearFromDate(entry.servingSince)}
                      </Typography.Text>
                    </div>

                    <div className="directory-card-contact">
                      <CopyContactLine
                        icon={<PhoneOutlined />}
                        value={entry.phone}
                        emptyText="No public phone"
                        label="Phone"
                        onCopy={copyContact}
                      />
                      <CopyContactLine
                        icon={<MailOutlined />}
                        value={entry.email || entry.contactFormUrl}
                        emptyText="No public email"
                        label={entry.email ? 'Email' : 'Contact form'}
                        onCopy={copyContact}
                      />
                    </div>

                    <div className="directory-card-meta">
                      {(entry.leadershipPositions[0] ||
                        entry.committees[0] ||
                        entry.focusAreas[0]) ??
                        'No policy coverage listed'}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {totalFiltered > PAGE_SIZE ? (
              <div className="directory-pagination">
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
        </Col>
      </Row>

      <Modal
        className="directory-profile-modal"
        width={1120}
        open={selectedEntry !== null}
        onCancel={() => setSelectedEntryId(null)}
        footer={null}
        title={null}
        destroyOnClose
      >
        {selectedEntry ? (
          <>
            <section className="directory-profile-hero">
              <Avatar
                src={selectedEntry.photoUrl || undefined}
                size={86}
                shape="square"
                className="directory-profile-photo"
              >
                {initials(selectedEntry.memberName)}
              </Avatar>
              <div className="directory-profile-main">
                <Space size={8} wrap>
                  <Tag className="directory-profile-member-tag">Member</Tag>
                  <Tag color={partyColor(selectedEntry.party)}>{selectedEntry.party}</Tag>
                  <Tag>{selectedEntry.district}</Tag>
                </Space>
                <Typography.Title level={2}>{selectedEntry.fullName}</Typography.Title>
                <Typography.Text>{selectedEntry.title}</Typography.Text>
                <Typography.Text type="secondary">
                  Serving in {selectedEntry.chamber} since{' '}
                  {yearFromDate(selectedEntry.servingSince)}
                </Typography.Text>
              </div>
              <Space className="directory-profile-actions" wrap>
                <Button
                  aria-label="Copy email"
                  onClick={() => copyContact(selectedEntry.email, 'Email')}
                >
                  <MailOutlined />
                </Button>
                <Button
                  aria-label="Copy phone"
                  onClick={() => copyContact(selectedEntry.phone, 'Phone')}
                >
                  <PhoneOutlined />
                </Button>
                {selectedEntry.contactFormUrl ? (
                  <Button href={selectedEntry.contactFormUrl} target="_blank" rel="noreferrer">
                    Contact Form
                  </Button>
                ) : null}
              </Space>
            </section>

            <Tabs
              className="directory-profile-tabs"
              defaultActiveKey="contact"
              items={[
                {
                  key: 'contact',
                  label: 'Contact',
                  children: (
                    <Row gutter={[24, 24]}>
                      <Col xs={24} lg={15}>
                        <Typography.Title level={4}>Contact</Typography.Title>
                        <div className="directory-contact-panel">
                          <div>
                            <Typography.Text strong>Main Office</Typography.Text>
                            <Typography.Paragraph>
                              {selectedEntry.officeLocation || 'No public office address listed'}
                            </Typography.Paragraph>
                            <div className="directory-profile-contact-lines">
                              <CopyableTextRow
                                label="Phone"
                                value={selectedEntry.phone}
                                emptyText="N/A"
                                onCopy={copyContact}
                              />
                              <Typography.Text>Fax: {selectedEntry.fax || 'N/A'}</Typography.Text>
                              <CopyableTextRow
                                label="Email"
                                value={selectedEntry.email}
                                emptyText="No public email listed"
                                onCopy={copyContact}
                              />
                            </div>
                          </div>
                          <div>
                            <Typography.Text strong>Official Links</Typography.Text>
                            <Space
                              direction="vertical"
                              size={4}
                              style={{ display: 'flex', marginTop: 8 }}
                            >
                              {selectedEntry.officialLinks.slice(0, 8).map((link) => (
                                <a
                                  key={`${link.type}-${link.url}`}
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {link.label}
                                </a>
                              ))}
                            </Space>
                          </div>
                        </div>

                        <Typography.Title level={4} style={{ marginTop: 28 }}>
                          Office Locations
                        </Typography.Title>
                        <div className="directory-address-list">
                          {selectedEntry.addresses.map((address) => (
                            <div key={address.id} className="directory-address-row">
                              <Typography.Text strong>{address.title || 'Office'}</Typography.Text>
                              <Typography.Text>
                                {[
                                  address.address1,
                                  address.address2,
                                  address.city,
                                  address.state,
                                  address.zip,
                                ]
                                  .filter(Boolean)
                                  .join(', ')}
                              </Typography.Text>
                              <Typography.Text type="secondary">
                                {address.phone || 'No phone'}{' '}
                                {address.fax ? `| Fax ${address.fax}` : ''}
                              </Typography.Text>
                            </div>
                          ))}
                        </div>
                      </Col>
                      <Col xs={24} lg={9}>
                        <Card className="directory-side-card" title="Snapshot">
                          <Space direction="vertical" size={10} style={{ display: 'flex' }}>
                            <Typography.Text>
                              Party: {selectedEntry.partyName} ({selectedEntry.party})
                            </Typography.Text>
                            <Typography.Text>
                              Gender: {genderLabel(selectedEntry.gender)}
                            </Typography.Text>
                            <Typography.Text>Region: {selectedEntry.region}</Typography.Text>
                            <Typography.Text>
                              Last source update: {selectedEntry.lastTouchpoint}
                            </Typography.Text>
                          </Space>
                        </Card>
                        <DirectoryNotesPanel entry={selectedEntry} />
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'staff',
                  label: 'Staff',
                  children: (
                    <div>
                      <Typography.Title level={4}>
                        {selectedEntry.fullName}'s Staff
                      </Typography.Title>
                      <div className="directory-staff-list">
                        {selectedEntry.staff.length > 0 ? (
                          <>
                            <div className="directory-staff-header" aria-hidden="true">
                              <span>Staffer</span>
                              <span>Roles &amp; Issue Areas</span>
                              <span>Phone</span>
                              <span>Email</span>
                            </div>
                            {selectedEntry.staff.map((staffer) => (
                              <div key={staffer.id} className="directory-staff-row">
                                <div className="directory-staff-person">
                                  <Typography.Text strong>{staffer.fullName}</Typography.Text>
                                  <Typography.Text type="secondary">
                                    {staffer.title}
                                  </Typography.Text>
                                </div>
                                <Space className="directory-staff-tags" size={[6, 6]} wrap>
                                  {staffer.roles.slice(0, 2).map((role) => (
                                    <Tag key={`${staffer.id}-${role}`}>{role}</Tag>
                                  ))}
                                  {staffer.issueAreas.slice(0, 3).map((issue) => (
                                    <Tag key={`${staffer.id}-${issue}`} color="blue">
                                      {issue}
                                    </Tag>
                                  ))}
                                </Space>
                                <StaffContactValue
                                  icon={<PhoneOutlined />}
                                  label="Phone"
                                  value={staffer.phone || selectedEntry.phone}
                                  emptyText="None listed"
                                  onCopy={copyContact}
                                />
                                <StaffContactValue
                                  icon={<MailOutlined />}
                                  label="Email"
                                  value={staffer.email}
                                  emptyText="None listed"
                                  onCopy={copyContact}
                                />
                              </div>
                            ))}
                          </>
                        ) : (
                          <Empty description="No staff records in source snapshot" />
                        )}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'bio',
                  label: 'Bio',
                  children: (
                    <Row gutter={[24, 16]}>
                      {[
                        ['Born', selectedEntry.bio.dob],
                        ['Birthplace', selectedEntry.bio.birthplace],
                        ['Hometown', selectedEntry.bio.hometown],
                        ['Occupation', selectedEntry.bio.occupation],
                        ['Race', selectedEntry.bio.race],
                        ['Religion', selectedEntry.bio.religion],
                        ['Pronunciation', selectedEntry.bio.pronunciation],
                      ].map(([label, value]) => (
                        <Col xs={24} sm={12} lg={8} key={label}>
                          <Card size="small" className="directory-bio-card">
                            <Typography.Text type="secondary">{label}</Typography.Text>
                            <Typography.Paragraph>{value || 'N/A'}</Typography.Paragraph>
                          </Card>
                        </Col>
                      ))}
                    </Row>
                  ),
                },
                {
                  key: 'committees',
                  label: 'Committees',
                  children: (
                    <Space size={[8, 8]} wrap>
                      {selectedEntry.committees.length > 0 ? (
                        selectedEntry.committees.map((committee) => (
                          <Tag key={committee} className="directory-large-tag">
                            {committee}
                          </Tag>
                        ))
                      ) : (
                        <Empty description="No committee data in source snapshot" />
                      )}
                    </Space>
                  ),
                },
                {
                  key: 'leadership',
                  label: 'Leadership',
                  children: (
                    <Space direction="vertical" size={12} style={{ display: 'flex' }}>
                      {selectedEntry.leadershipPositions.length > 0 ? (
                        selectedEntry.leadershipPositions.map((position) => (
                          <Card key={position} size="small" className="directory-leadership-card">
                            <Typography.Text strong>{position}</Typography.Text>
                          </Card>
                        ))
                      ) : (
                        <Empty description="No current leadership roles in source snapshot" />
                      )}
                    </Space>
                  ),
                },
                {
                  key: 'links',
                  label: 'Links',
                  children: (
                    <div className="directory-link-grid">
                      {selectedEntry.officialLinks.map((link) => (
                        <a
                          key={`${link.type}-${link.url}`}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <LinkOutlined /> {link.label}
                        </a>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          </>
        ) : null}
      </Modal>
    </div>
  );
}

function CopyContactLine({
  icon,
  value,
  emptyText,
  label,
  onCopy,
}: {
  icon: ReactNode;
  value: string;
  emptyText: string;
  label: string;
  onCopy: (value: string, label: string) => Promise<void>;
}) {
  const copyValue = value.trim();
  return (
    <button
      className="directory-copy-line"
      type="button"
      disabled={!copyValue}
      onClick={(event) => {
        event.stopPropagation();
        void onCopy(copyValue, label);
      }}
      title={copyValue ? `Copy ${label.toLowerCase()}` : emptyText}
    >
      <span className="directory-copy-line-main">
        {icon}
        <span>{copyValue || emptyText}</span>
      </span>
      {copyValue ? <CopyOutlined /> : null}
    </button>
  );
}

function CopyableTextRow({
  label,
  value,
  emptyText,
  onCopy,
  compact = false,
}: {
  label: string;
  value: string;
  emptyText: string;
  onCopy: (value: string, label: string) => Promise<void>;
  compact?: boolean;
}) {
  const copyValue = value.trim();
  return (
    <span
      className={
        compact
          ? 'directory-copyable-text-row directory-copyable-text-row--compact'
          : 'directory-copyable-text-row'
      }
    >
      <Typography.Text>
        {compact ? null : `${label}: `}
        {copyValue || emptyText}
      </Typography.Text>
      {copyValue ? (
        <Button
          size="small"
          type="text"
          icon={<CopyOutlined />}
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void onCopy(copyValue, label)}
        />
      ) : null}
    </span>
  );
}

function StaffContactValue({
  icon,
  label,
  value,
  emptyText,
  onCopy,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  emptyText: string;
  onCopy: (value: string, label: string) => Promise<void>;
}) {
  const copyValue = value.trim();
  return (
    <span className="directory-staff-contact-value" title={copyValue ? `Copy ${label}` : emptyText}>
      <span className="directory-staff-contact-main">
        {icon}
        <Typography.Text type={copyValue ? undefined : 'secondary'}>
          {copyValue || emptyText}
        </Typography.Text>
      </span>
      {copyValue ? (
        <Button
          size="small"
          type="text"
          icon={<CopyOutlined />}
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void onCopy(copyValue, label)}
        />
      ) : null}
    </span>
  );
}

function DirectoryNotesPanel({ entry }: { entry: DirectoryEntry }) {
  const { message } = App.useApp();
  const api = useApi();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');

  const notes = useQuery<DirectoryContactNote[]>({
    queryKey: ['directory-contact-notes', entry.id],
    queryFn: async () =>
      (
        await api.get<DirectoryContactNote[]>(
          `/api/directory/contacts/${encodeURIComponent(entry.id)}/notes`,
        )
      ).data,
    staleTime: 15_000,
  });

  const createNote = useMutation({
    mutationFn: async () =>
      (
        await api.post<DirectoryContactNote>(
          `/api/directory/contacts/${encodeURIComponent(entry.id)}/notes`,
          {
            body,
            directoryContactName: entry.fullName,
          },
        )
      ).data,
    onSuccess: async () => {
      setBody('');
      await queryClient.invalidateQueries({ queryKey: ['directory-contact-notes', entry.id] });
      message.success('Note added.');
    },
    onError: (error) => {
      message.error((error as Error).message || 'Could not add note.');
    },
  });

  const trimmedBody = body.trim();

  return (
    <Card className="directory-side-card directory-notes-card" title="Notes">
      <Space direction="vertical" size={12} style={{ display: 'flex' }}>
        <Input.TextArea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a tenant-visible note"
          maxLength={4000}
          showCount
          autoSize={{ minRows: 3, maxRows: 7 }}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={createNote.isPending}
          disabled={!trimmedBody}
          onClick={() => createNote.mutate()}
        >
          Add note
        </Button>

        {notes.isLoading ? (
          <Space>
            <Spin size="small" />
            <Typography.Text type="secondary">Loading notes...</Typography.Text>
          </Space>
        ) : null}

        {!notes.isLoading && (notes.data?.length ?? 0) === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notes yet" />
        ) : null}

        <div className="directory-note-list">
          {(notes.data ?? []).map((note) => (
            <div key={note.id} className="directory-note-preview">
              <Typography.Paragraph>{note.body}</Typography.Paragraph>
              <Typography.Text type="secondary">
                {formatNoteDate(note.createdAt)} by {noteAuthor(note)}
              </Typography.Text>
            </div>
          ))}
        </div>
      </Space>
    </Card>
  );
}
