import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Drawer, Empty, Input, Pagination, Select, Skeleton, Table, Tag, Typography } from 'antd';
import {
  AuditOutlined,
  BankOutlined,
  BookOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  GlobalOutlined,
  ReadOutlined,
  ScheduleOutlined,
  SearchOutlined,
  SolutionOutlined,
} from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import {
  type BillDetail,
  type BillFacets,
  type ContractorDetail,
  type ContractorFacets,
  type CrsFacets,
  type ExplorerBillRow,
  type ExplorerContractorRow,
  type ExplorerCrsRow,
  type ExplorerFaraRow,
  type ExplorerFecRow,
  type ExplorerFedRegRow,
  type ExplorerGaoRow,
  type ExplorerHearingRow,
  type ExplorerIntelArticleRow,
  type ExplorerLdaFilingRow,
  type ExplorerResponse,
  type ExplorerSecRow,
  type ExplorerStateBillRow,
  type FaraFacets,
  type FecFacets,
  type FedRegDetail,
  type FedRegFacets,
  type GaoFacets,
  type HearingFacets,
  type IntelArticleFacets,
  type LdaFacets,
  type LdaFilingDetail,
  type SecFacets,
  type StateBillFacets,
} from './explorerTypes.js';

const PAGE_SIZE = 25;

type SourceKey =
  | 'lda'
  | 'contractors'
  | 'bills'
  | 'fedreg'
  | 'hearings'
  | 'gao'
  | 'crs'
  | 'fec'
  | 'fara'
  | 'sec'
  | 'articles'
  | 'state-bills'
  | 'comment-deadlines';

interface SourceMeta {
  key: SourceKey;
  label: string;
  description: string;
  icon: ReactNode;
}

const SOURCES: SourceMeta[] = [
  { key: 'lda', label: 'LDA Filings', description: 'Lobbying Disclosure Act — 500K+ filings, 5 years.', icon: <BookOutlined /> },
  { key: 'contractors', label: 'Federal Contractors', description: 'Top contractors with no-bid totals + agency mix.', icon: <BankOutlined /> },
  { key: 'bills', label: 'Congress Bills', description: 'Bills with sponsor, latest action, subject tags.', icon: <FileTextOutlined /> },
  { key: 'fedreg', label: 'Federal Register', description: 'Proposed/final rules, comment-period deadlines.', icon: <GlobalOutlined /> },
  { key: 'hearings', label: 'Hearings', description: 'Committee hearings and markups by chamber + date.', icon: <ScheduleOutlined /> },
  { key: 'gao', label: 'GAO Reports', description: 'GAO oversight reports + recommendations by topic.', icon: <FileSearchOutlined /> },
  { key: 'crs', label: 'CRS Reports', description: 'Congressional Research Service briefings.', icon: <ReadOutlined /> },
  { key: 'fec', label: 'FEC Contributions', description: 'Itemized political contributions, by cycle.', icon: <DollarOutlined /> },
  { key: 'fara', label: 'FARA Filings', description: 'Foreign agent registrations by country/principal.', icon: <GlobalOutlined /> },
  { key: 'sec', label: 'SEC Filings', description: '8-K, 10-Q, S-1 from SEC EDGAR.', icon: <AuditOutlined /> },
  { key: 'articles', label: 'News Feed', description: 'RSS-ingested intel articles (Politico, RollCall, etc.).', icon: <ReadOutlined /> },
  { key: 'state-bills', label: 'State Bills', description: 'State legislation via OpenStates.', icon: <SolutionOutlined /> },
  { key: 'comment-deadlines', label: 'Comment Deadlines', description: 'Open comment periods on federal rules, closing soonest.', icon: <ClockCircleOutlined /> },
];

type DrillIn = { source: SourceKey; id: string; rowSummary: ReactNode } | null;

export function DataExplorerPage() {
  const [source, setSource] = useState<SourceKey>('lda');
  const [drillIn, setDrillIn] = useState<DrillIn>(null);

  return (
    <section className="explorer-page redesign">
      <header className="explorer-page-head">
        <div>
          <h1>Data Explorer</h1>
          <p className="explorer-page-dek">
            Search and filter every federal data source Capiro tracks. Click a row to inspect the full record.
          </p>
        </div>
      </header>

      <nav className="explorer-source-tabs" aria-label="Data sources">
        {SOURCES.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`explorer-source-tab${source === s.key ? ' is-active' : ''}`}
            onClick={() => setSource(s.key)}
          >
            <span className="explorer-source-tab-icon" aria-hidden>
              {s.icon}
            </span>
            <span>
              <span className="explorer-source-tab-label">{s.label}</span>
              <span className="explorer-source-tab-dek">{s.description}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="explorer-source-body">
        {source === 'lda' ? <LdaFilingsExplorer onRowClick={(id, row) => setDrillIn({ source: 'lda', id, rowSummary: row.clientName })} /> : null}
        {source === 'contractors' ? <ContractorsExplorer onRowClick={(id, row) => setDrillIn({ source: 'contractors', id, rowSummary: row.name })} /> : null}
        {source === 'bills' ? <BillsExplorer onRowClick={(id, row) => setDrillIn({ source: 'bills', id, rowSummary: `${row.billType} ${row.billNumber}` })} /> : null}
        {source === 'fedreg' ? <FedRegExplorer onRowClick={(id, row) => setDrillIn({ source: 'fedreg', id, rowSummary: row.title })} /> : null}
        {source === 'hearings' ? <HearingsExplorer onRowClick={(id, row) => setDrillIn({ source: 'hearings', id, rowSummary: row.title })} /> : null}
        {source === 'gao' ? <GaoExplorer onRowClick={(id, row) => setDrillIn({ source: 'gao', id, rowSummary: row.title })} /> : null}
        {source === 'crs' ? <CrsExplorer onRowClick={(id, row) => setDrillIn({ source: 'crs', id, rowSummary: row.title })} /> : null}
        {source === 'fec' ? <FecExplorer onRowClick={(id, row) => setDrillIn({ source: 'fec', id, rowSummary: row.contributorName ?? row.committeeName ?? '' })} /> : null}
        {source === 'fara' ? <FaraExplorer onRowClick={(id, row) => setDrillIn({ source: 'fara', id, rowSummary: row.registrantName })} /> : null}
        {source === 'sec' ? <SecExplorer onRowClick={(id, row) => setDrillIn({ source: 'sec', id, rowSummary: row.companyName })} /> : null}
        {source === 'articles' ? <ArticlesExplorer onRowClick={(id, row) => setDrillIn({ source: 'articles', id, rowSummary: row.title })} /> : null}
        {source === 'state-bills' ? <StateBillsExplorer onRowClick={(id, row) => setDrillIn({ source: 'state-bills', id, rowSummary: `${row.state} ${row.identifier}` })} /> : null}
        {source === 'comment-deadlines' ? <CommentDeadlinesExplorer onRowClick={(id, row) => setDrillIn({ source: 'comment-deadlines', id, rowSummary: row.title })} /> : null}
      </div>

      <ExplorerDrillInDrawer drillIn={drillIn} onClose={() => setDrillIn(null)} />
    </section>
  );
}

/* ── LDA Filings ────────────────────────────────────────────────────────── */

function LdaFilingsExplorer({
  onRowClick,
}: {
  onRowClick: (id: string, row: ExplorerLdaFilingRow) => void;
}) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [issueCodes, setIssueCodes] = useState<string[]>([]);
  const [years, setYears] = useState<string[]>([]);
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [q, issueCodes, years, sort]);

  const facets = useQuery<LdaFacets>({
    queryKey: ['explorer-lda-facets'],
    queryFn: async () => (await api.get<LdaFacets>('/api/explorer/lda-facets')).data,
    staleTime: 10 * 60 * 1000,
  });

  const rowsQuery = useQuery<ExplorerResponse<ExplorerLdaFilingRow>>({
    queryKey: ['explorer-lda-filings', q, issueCodes, years, sort, page],
    queryFn: async () =>
      (
        await api.get<ExplorerResponse<ExplorerLdaFilingRow>>('/api/explorer/lda-filings', {
          params: {
            q: q || undefined,
            issueCodes: issueCodes.length ? issueCodes.join(',') : undefined,
            years: years.length ? years.join(',') : undefined,
            sort,
            page,
            pageSize: PAGE_SIZE,
          },
        })
      ).data,
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search registrant or client name…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => {
          setSearchInput('');
          setQ('');
        }}
        controls={
          <>
            <MultiSelect
              label="Issue codes"
              placeholder="Any issue"
              options={(facets.data?.issueCodes ?? []).map((c) => ({
                value: c.code,
                label: `${c.code} — ${c.name}`,
              }))}
              values={issueCodes}
              onChange={setIssueCodes}
              loading={facets.isLoading}
            />
            <MultiSelect
              label="Year"
              placeholder="Any year"
              options={(facets.data?.years ?? []).map((y) => ({
                value: String(y),
                label: String(y),
              }))}
              values={years}
              onChange={setYears}
              loading={facets.isLoading}
            />
            <SortControl
              value={sort}
              onChange={setSort}
              options={[
                { value: 'recent', label: 'Recently posted' },
                { value: 'income', label: 'Highest income' },
                { value: 'year', label: 'Filing year (desc)' },
                { value: 'client', label: 'Client (A–Z)' },
                { value: 'registrant', label: 'Registrant (A–Z)' },
              ]}
            />
          </>
        }
      />

      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          {
            title: 'Year / Period',
            dataIndex: 'filingYear',
            width: 110,
            render: (year: number, row: ExplorerLdaFilingRow) => (
              <span className="num">
                {year}
                {row.filingPeriod ? ` · ${row.filingPeriod}` : ''}
              </span>
            ),
          },
          {
            title: 'Type',
            dataIndex: 'filingType',
            width: 80,
            render: (t: string) => <Tag className="redesign-mono-tag">{t}</Tag>,
          },
          {
            title: 'Registrant',
            dataIndex: 'registrantName',
            ellipsis: true,
          },
          {
            title: 'Client',
            dataIndex: 'clientName',
            ellipsis: true,
          },
          {
            title: 'State',
            dataIndex: 'clientState',
            width: 70,
            render: (s: string | null) =>
              s ? <span className="state-pill num">{s}</span> : '—',
          },
          {
            title: 'Income',
            dataIndex: 'income',
            width: 110,
            align: 'right' as const,
            render: (v: number | null) => (
              <span className="num" style={{ fontWeight: 500 }}>
                {formatMoney(v)}
              </span>
            ),
          },
          {
            title: 'Issues',
            dataIndex: 'issueCodes',
            width: 200,
            render: (codes: string[]) => (
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {codes.slice(0, 4).map((c) => (
                  <Tag key={c} className="redesign-mono-tag">
                    {c}
                  </Tag>
                ))}
                {codes.length > 4 ? <Tag>+{codes.length - 4}</Tag> : null}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}

/* ── Federal Contractors ────────────────────────────────────────────────── */

function ContractorsExplorer({
  onRowClick,
}: {
  onRowClick: (id: string, row: ExplorerContractorRow) => void;
}) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [hasNoBid, setHasNoBid] = useState(false);
  const [sort, setSort] = useState('total');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [q, categories, hasNoBid, sort]);

  const facets = useQuery<ContractorFacets>({
    queryKey: ['explorer-contractor-facets'],
    queryFn: async () => (await api.get<ContractorFacets>('/api/explorer/contractor-facets')).data,
    staleTime: 10 * 60 * 1000,
  });

  const rowsQuery = useQuery<ExplorerResponse<ExplorerContractorRow>>({
    queryKey: ['explorer-contractors', q, categories, hasNoBid, sort, page],
    queryFn: async () =>
      (
        await api.get<ExplorerResponse<ExplorerContractorRow>>('/api/explorer/federal-contractors', {
          params: {
            q: q || undefined,
            categories: categories.length ? categories.join(',') : undefined,
            hasNoBid: hasNoBid ? true : undefined,
            sort,
            page,
            pageSize: PAGE_SIZE,
          },
        })
      ).data,
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search contractor name…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => {
          setSearchInput('');
          setQ('');
        }}
        controls={
          <>
            <MultiSelect
              label="Category"
              placeholder="Any category"
              options={(facets.data?.categories ?? []).map((c) => ({ value: c, label: c }))}
              values={categories}
              onChange={setCategories}
              loading={facets.isLoading}
            />
            <ToggleChip
              label="Has no-bid awards"
              active={hasNoBid}
              onToggle={() => setHasNoBid((v) => !v)}
            />
            <SortControl
              value={sort}
              onChange={setSort}
              options={[
                { value: 'total', label: 'Largest contracts' },
                { value: 'no-bid', label: 'Largest no-bid' },
                { value: 'name', label: 'Name (A–Z)' },
              ]}
            />
          </>
        }
      />

      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          { title: 'Rank', dataIndex: 'rankByContracts', width: 80, render: (v: number | null) => v ? `#${v}` : '—' },
          { title: 'Contractor', dataIndex: 'name', ellipsis: true },
          { title: 'Category', dataIndex: 'category', width: 130, render: (c: string | null) => c ?? '—' },
          {
            title: 'Total Contracts',
            dataIndex: 'totalContracts',
            width: 140,
            align: 'right' as const,
            render: (v: number | null) => <span className="num">{formatMoney(v)}</span>,
          },
          {
            title: 'No-bid Total',
            dataIndex: 'noBidTotal',
            width: 130,
            align: 'right' as const,
            render: (v: number | null) => (
              <span className="num" style={{ color: v && v > 0 ? 'var(--critical)' : 'var(--ink-3)' }}>
                {formatMoney(v)}
              </span>
            ),
          },
          { title: 'UEI', dataIndex: 'uei', width: 130, render: (u: string | null) => u ? <span className="num" style={{ fontSize: 11 }}>{u}</span> : '—' },
        ]}
      />
    </>
  );
}

/* ── Congress Bills ─────────────────────────────────────────────────────── */

function BillsExplorer({
  onRowClick,
}: {
  onRowClick: (id: string, row: ExplorerBillRow) => void;
}) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [congress, setCongress] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [parties, setParties] = useState<string[]>([]);
  const [chambers, setChambers] = useState<string[]>([]);
  const [sort, setSort] = useState('action');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [q, congress, subjects, parties, chambers, sort]);

  const facets = useQuery<BillFacets>({
    queryKey: ['explorer-bill-facets'],
    queryFn: async () => (await api.get<BillFacets>('/api/explorer/bill-facets')).data,
    staleTime: 10 * 60 * 1000,
  });

  const rowsQuery = useQuery<ExplorerResponse<ExplorerBillRow>>({
    queryKey: ['explorer-bills', q, congress, subjects, parties, chambers, sort, page],
    queryFn: async () =>
      (
        await api.get<ExplorerResponse<ExplorerBillRow>>('/api/explorer/congress-bills', {
          params: {
            q: q || undefined,
            congress: congress.length ? congress.join(',') : undefined,
            subjects: subjects.length ? subjects.join(',') : undefined,
            sponsorParty: parties.length ? parties.join(',') : undefined,
            originChamber: chambers.length ? chambers.join(',') : undefined,
            sort,
            page,
            pageSize: PAGE_SIZE,
          },
        })
      ).data,
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search bill title or sponsor…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => {
          setSearchInput('');
          setQ('');
        }}
        controls={
          <>
            <MultiSelect
              label="Congress"
              placeholder="Any"
              options={(facets.data?.congresses ?? []).map((c) => ({
                value: String(c),
                label: `${c}th`,
              }))}
              values={congress}
              onChange={setCongress}
              loading={facets.isLoading}
            />
            <MultiSelect
              label="Chamber"
              placeholder="Any"
              options={(facets.data?.chambers ?? []).map((c) => ({ value: c, label: c }))}
              values={chambers}
              onChange={setChambers}
              loading={facets.isLoading}
            />
            <MultiSelect
              label="Party"
              placeholder="Any"
              options={(facets.data?.parties ?? []).map((p) => ({ value: p, label: partyName(p) }))}
              values={parties}
              onChange={setParties}
              loading={facets.isLoading}
            />
            <MultiSelect
              label="Subject"
              placeholder="Any subject"
              options={(facets.data?.subjects ?? []).map((s) => ({ value: s, label: s }))}
              values={subjects}
              onChange={setSubjects}
              loading={facets.isLoading}
            />
            <SortControl
              value={sort}
              onChange={setSort}
              options={[
                { value: 'action', label: 'Latest action' },
                { value: 'introduced', label: 'Recently introduced' },
                { value: 'cosponsors', label: 'Most cosponsors' },
              ]}
            />
          </>
        }
      />

      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          {
            title: 'Bill',
            dataIndex: 'billType',
            width: 110,
            render: (_: unknown, r: ExplorerBillRow) => (
              <span className="num" style={{ fontWeight: 600 }}>
                {r.billType} {r.billNumber}
              </span>
            ),
          },
          { title: 'Title', dataIndex: 'title', ellipsis: true },
          {
            title: 'Sponsor',
            dataIndex: 'sponsorName',
            width: 200,
            render: (name: string | null, r: ExplorerBillRow) =>
              name ? (
                <span>
                  {name}
                  {r.sponsorParty ? (
                    <span className={`party-pill ${r.sponsorParty.toLowerCase()}`} style={{ marginLeft: 6 }}>
                      {r.sponsorParty}
                    </span>
                  ) : null}
                </span>
              ) : (
                '—'
              ),
          },
          {
            title: 'Cosponsors',
            dataIndex: 'cosponsorsCount',
            width: 100,
            align: 'right' as const,
            render: (v: number) => <span className="num">{v}</span>,
          },
          {
            title: 'Latest action',
            dataIndex: 'latestActionText',
            ellipsis: true,
            render: (text: string | null, r: ExplorerBillRow) => (
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12.5 }}>{text ?? '—'}</span>
                {r.latestActionDate ? (
                  <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    {formatDate(r.latestActionDate)}
                  </span>
                ) : null}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}

/* ── Federal Register Documents ─────────────────────────────────────────── */

function FedRegExplorer({
  onRowClick,
}: {
  onRowClick: (id: string, row: ExplorerFedRegRow) => void;
}) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [agencies, setAgencies] = useState<string[]>([]);
  const [significantOnly, setSignificantOnly] = useState(false);
  const [openCommentOnly, setOpenCommentOnly] = useState(true);
  const [sort, setSort] = useState('comment-close');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [q, types, agencies, significantOnly, openCommentOnly, sort]);

  const facets = useQuery<FedRegFacets>({
    queryKey: ['explorer-fed-reg-facets'],
    queryFn: async () => (await api.get<FedRegFacets>('/api/explorer/fed-reg-facets')).data,
    staleTime: 10 * 60 * 1000,
  });

  const rowsQuery = useQuery<ExplorerResponse<ExplorerFedRegRow>>({
    queryKey: ['explorer-fed-reg', q, types, agencies, significantOnly, openCommentOnly, sort, page],
    queryFn: async () =>
      (
        await api.get<ExplorerResponse<ExplorerFedRegRow>>('/api/explorer/federal-register', {
          params: {
            q: q || undefined,
            types: types.length ? types.join(',') : undefined,
            agencies: agencies.length ? agencies.join(',') : undefined,
            significantOnly: significantOnly ? true : undefined,
            openCommentOnly: openCommentOnly ? true : undefined,
            sort,
            page,
            pageSize: PAGE_SIZE,
          },
        })
      ).data,
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search title or abstract…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => {
          setSearchInput('');
          setQ('');
        }}
        controls={
          <>
            <MultiSelect
              label="Type"
              placeholder="Any"
              options={(facets.data?.types ?? []).map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))}
              values={types}
              onChange={setTypes}
              loading={facets.isLoading}
            />
            <MultiSelect
              label="Agency"
              placeholder="Any agency"
              options={(facets.data?.agencies ?? []).map((a) => ({ value: a, label: a }))}
              values={agencies}
              onChange={setAgencies}
              loading={facets.isLoading}
            />
            <ToggleChip
              label="Significant rules only"
              active={significantOnly}
              onToggle={() => setSignificantOnly((v) => !v)}
            />
            <ToggleChip
              label="Comment period open"
              active={openCommentOnly}
              onToggle={() => setOpenCommentOnly((v) => !v)}
            />
            <SortControl
              value={sort}
              onChange={setSort}
              options={[
                { value: 'comment-close', label: 'Closing soonest' },
                { value: 'publication', label: 'Most recent' },
              ]}
            />
          </>
        }
      />

      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          { title: 'Type', dataIndex: 'type', width: 130, render: (t: string) => <Tag className="redesign-mono-tag">{t.replace(/_/g, ' ')}</Tag> },
          {
            title: 'Title',
            dataIndex: 'title',
            ellipsis: true,
            render: (title: string, r: ExplorerFedRegRow) =>
              r.htmlUrl ? (
                <a href={r.htmlUrl} target="_blank" rel="noreferrer">
                  {title}
                </a>
              ) : (
                title
              ),
          },
          {
            title: 'Agency',
            dataIndex: 'agencyNames',
            width: 220,
            render: (agencies: string[]) => (
              <span>
                {agencies.slice(0, 1).join('')}
                {agencies.length > 1 ? <span style={{ color: 'var(--ink-3)' }}> +{agencies.length - 1}</span> : null}
              </span>
            ),
          },
          {
            title: 'Comment closes',
            dataIndex: 'commentEndDate',
            width: 150,
            render: (d: string | null) => {
              if (!d) return <span style={{ color: 'var(--ink-3)' }}>—</span>;
              const days = Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              const sev: 'critical' | 'notable' | 'info' =
                days <= 3 ? 'critical' : days <= 14 ? 'notable' : 'info';
              return (
                <span className="num">
                  <span className={`pill ${sev}`} style={{ marginRight: 8 }}>
                    {days <= 0 ? 'closed' : `${days}d`}
                  </span>
                  {formatDate(d)}
                </span>
              );
            },
          },
          {
            title: 'Significant',
            dataIndex: 'significantRule',
            width: 110,
            render: (b: boolean) => (b ? <Tag color="gold">significant</Tag> : null),
          },
        ]}
      />
    </>
  );
}

/* ── Comment Deadlines (Federal Register, open-comment preset) ──────────── */

function CommentDeadlinesExplorer({
  onRowClick,
}: {
  onRowClick: (id: string, row: ExplorerFedRegRow) => void;
}) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [agencies, setAgencies] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, agencies]);

  const facets = useQuery<FedRegFacets>({
    queryKey: ['explorer-fed-reg-facets'],
    queryFn: async () => (await api.get<FedRegFacets>('/api/explorer/fed-reg-facets')).data,
    staleTime: 10 * 60 * 1000,
  });

  const rowsQuery = useQuery<ExplorerResponse<ExplorerFedRegRow>>({
    queryKey: ['explorer-comment-deadlines', q, agencies, page],
    queryFn: async () =>
      (
        await api.get<ExplorerResponse<ExplorerFedRegRow>>('/api/explorer/federal-register', {
          params: {
            q: q || undefined,
            agencies: agencies.length ? agencies.join(',') : undefined,
            openCommentOnly: true,
            sort: 'comment-close',
            page,
            pageSize: PAGE_SIZE,
          },
        })
      ).data,
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search rule title or abstract…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => {
          setSearchInput('');
          setQ('');
        }}
        controls={
          <MultiSelect
            label="Agency"
            placeholder="Any agency"
            options={(facets.data?.agencies ?? []).map((a) => ({ value: a, label: a }))}
            values={agencies}
            onChange={setAgencies}
            loading={facets.isLoading}
          />
        }
      />

      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          {
            title: 'Comment closes',
            dataIndex: 'commentEndDate',
            width: 170,
            render: (d: string | null) => {
              if (!d) return <span style={{ color: 'var(--ink-3)' }}>—</span>;
              const days = Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              const sev: 'critical' | 'notable' | 'info' =
                days <= 3 ? 'critical' : days <= 14 ? 'notable' : 'info';
              return (
                <span className="num">
                  <span className={`pill ${sev}`} style={{ marginRight: 8 }}>
                    {days <= 0 ? 'closed' : `${days}d left`}
                  </span>
                  {formatDate(d)}
                </span>
              );
            },
          },
          {
            title: 'Title',
            dataIndex: 'title',
            ellipsis: true,
            render: (title: string, r: ExplorerFedRegRow) =>
              r.htmlUrl ? (
                <a href={r.htmlUrl} target="_blank" rel="noreferrer">
                  {title}
                </a>
              ) : (
                title
              ),
          },
          {
            title: 'Agency',
            dataIndex: 'agencyNames',
            width: 220,
            render: (a: string[]) => (
              <span>
                {a.slice(0, 1).join('')}
                {a.length > 1 ? <span style={{ color: 'var(--ink-3)' }}> +{a.length - 1}</span> : null}
              </span>
            ),
          },
          {
            title: 'Type',
            dataIndex: 'type',
            width: 140,
            render: (t: string) => <Tag className="redesign-mono-tag">{t.replace(/_/g, ' ')}</Tag>,
          },
        ]}
      />
    </>
  );
}

/* ── Committee hearings ─────────────────────────────────────────────────── */

function HearingsExplorer({ onRowClick }: { onRowClick: (id: string, row: ExplorerHearingRow) => void }) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [chambers, setChambers] = useState<string[]>([]);
  const [committees, setCommittees] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [futureOnly, setFutureOnly] = useState(true);
  const [sort, setSort] = useState('future');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, chambers, committees, types, futureOnly, sort]);

  const facets = useQuery<HearingFacets>({
    queryKey: ['explorer-hearing-facets'],
    queryFn: async () => (await api.get<HearingFacets>('/api/explorer/hearing-facets')).data,
    staleTime: 10 * 60 * 1000,
  });
  const rowsQuery = useQuery<ExplorerResponse<ExplorerHearingRow>>({
    queryKey: ['explorer-hearings', q, chambers, committees, types, futureOnly, sort, page],
    queryFn: async () =>
      (await api.get<ExplorerResponse<ExplorerHearingRow>>('/api/explorer/hearings', {
        params: {
          q: q || undefined,
          chambers: chambers.length ? chambers.join(',') : undefined,
          committees: committees.length ? committees.join(',') : undefined,
          types: types.length ? types.join(',') : undefined,
          futureOnly: futureOnly ? true : undefined,
          sort,
          page,
          pageSize: PAGE_SIZE,
        },
      })).data,
    placeholderData: (p) => p,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search hearing title or committee…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => { setSearchInput(''); setQ(''); }}
        controls={
          <>
            <MultiSelect label="Chamber" placeholder="Any" options={(facets.data?.chambers ?? []).map((c) => ({ value: c, label: c }))} values={chambers} onChange={setChambers} loading={facets.isLoading} />
            <MultiSelect label="Committee" placeholder="Any" options={(facets.data?.committees ?? []).map((c) => ({ value: c, label: c }))} values={committees} onChange={setCommittees} loading={facets.isLoading} />
            <MultiSelect label="Type" placeholder="Any" options={(facets.data?.types ?? []).map((t) => ({ value: t, label: t }))} values={types} onChange={setTypes} loading={facets.isLoading} />
            <ToggleChip label="Upcoming only" active={futureOnly} onToggle={() => setFutureOnly((v) => !v)} />
            <SortControl value={sort} onChange={setSort} options={[
              { value: 'future', label: 'Soonest first' },
              { value: 'past', label: 'Most recent first' },
            ]} />
          </>
        }
      />
      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          { title: 'Date', dataIndex: 'date', width: 120, render: (d: string, r: ExplorerHearingRow) => <span className="num">{formatDate(d)}{r.time ? ` · ${r.time}` : ''}</span> },
          { title: 'Chamber', dataIndex: 'chamber', width: 90 },
          { title: 'Committee', dataIndex: 'committeeName', ellipsis: true },
          { title: 'Title', dataIndex: 'title', ellipsis: true },
          { title: 'Type', dataIndex: 'type', width: 100, render: (t: string | null) => t ? <Tag className="redesign-mono-tag">{t}</Tag> : '—' },
          { title: 'Witnesses', dataIndex: 'witnesses', width: 100, align: 'right' as const, render: (w: string[]) => <span className="num">{w.length}</span> },
        ]}
      />
    </>
  );
}

/* ── GAO reports ────────────────────────────────────────────────────────── */

function GaoExplorer({ onRowClick }: { onRowClick: (id: string, row: ExplorerGaoRow) => void }) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [reportTypes, setReportTypes] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, reportTypes, topics, sort]);

  const facets = useQuery<GaoFacets>({
    queryKey: ['explorer-gao-facets'],
    queryFn: async () => (await api.get<GaoFacets>('/api/explorer/gao-facets')).data,
    staleTime: 10 * 60 * 1000,
  });
  const rowsQuery = useQuery<ExplorerResponse<ExplorerGaoRow>>({
    queryKey: ['explorer-gao', q, reportTypes, topics, sort, page],
    queryFn: async () => (await api.get<ExplorerResponse<ExplorerGaoRow>>('/api/explorer/gao', {
      params: { q: q || undefined, reportTypes: reportTypes.length ? reportTypes.join(',') : undefined, topics: topics.length ? topics.join(',') : undefined, sort, page, pageSize: PAGE_SIZE },
    })).data,
    placeholderData: (p) => p,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search GAO report title…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => { setSearchInput(''); setQ(''); }}
        controls={
          <>
            <MultiSelect label="Type" placeholder="Any" options={(facets.data?.reportTypes ?? []).map((t) => ({ value: t, label: t }))} values={reportTypes} onChange={setReportTypes} loading={facets.isLoading} />
            <MultiSelect label="Topic" placeholder="Any topic" options={(facets.data?.topics ?? []).map((t) => ({ value: t, label: t }))} values={topics} onChange={setTopics} loading={facets.isLoading} />
            <SortControl value={sort} onChange={setSort} options={[
              { value: 'recent', label: 'Most recent' },
              { value: 'recs', label: 'Most recommendations' },
            ]} />
          </>
        }
      />
      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          { title: 'Report #', dataIndex: 'id', width: 150, render: (id: string) => <span className="num" style={{ fontFamily: 'var(--font-mono-rd)', fontSize: 11 }}>{id}</span> },
          { title: 'Type', dataIndex: 'reportType', width: 130, render: (t: string | null) => t ? <Tag className="redesign-mono-tag">{t}</Tag> : '—' },
          { title: 'Title', dataIndex: 'title', ellipsis: true, render: (title: string, r: ExplorerGaoRow) => r.url ? <a href={r.url} target="_blank" rel="noreferrer">{title}</a> : title },
          { title: 'Topics', dataIndex: 'topics', width: 220, render: (topics: string[]) => <ChipList items={topics} max={3} /> },
          { title: 'Recs', dataIndex: 'recommendations', width: 70, align: 'right' as const, render: (n: number | null) => <span className="num">{n ?? '—'}</span> },
          { title: 'Date', dataIndex: 'publishDate', width: 110, render: (d: string | null) => d ? <span className="num">{formatDate(d)}</span> : '—' },
        ]}
      />
    </>
  );
}

/* ── CRS reports ────────────────────────────────────────────────────────── */

function CrsExplorer({ onRowClick }: { onRowClick: (id: string, row: ExplorerCrsRow) => void }) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, topics, activeOnly]);

  const facets = useQuery<CrsFacets>({
    queryKey: ['explorer-crs-facets'],
    queryFn: async () => (await api.get<CrsFacets>('/api/explorer/crs-facets')).data,
    staleTime: 10 * 60 * 1000,
  });
  const rowsQuery = useQuery<ExplorerResponse<ExplorerCrsRow>>({
    queryKey: ['explorer-crs', q, topics, activeOnly, page],
    queryFn: async () => (await api.get<ExplorerResponse<ExplorerCrsRow>>('/api/explorer/crs', {
      params: { q: q || undefined, topics: topics.length ? topics.join(',') : undefined, activeOnly: activeOnly ? true : undefined, page, pageSize: PAGE_SIZE },
    })).data,
    placeholderData: (p) => p,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search CRS title…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => { setSearchInput(''); setQ(''); }}
        controls={
          <>
            <MultiSelect label="Topic" placeholder="Any topic" options={(facets.data?.topics ?? []).map((t) => ({ value: t, label: t }))} values={topics} onChange={setTopics} loading={facets.isLoading} />
            <ToggleChip label="Active only" active={activeOnly} onToggle={() => setActiveOnly((v) => !v)} />
          </>
        }
      />
      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          { title: 'Report #', dataIndex: 'id', width: 100, render: (id: string) => <span className="num" style={{ fontFamily: 'var(--font-mono-rd)', fontSize: 11 }}>{id}</span> },
          { title: 'Title', dataIndex: 'title', ellipsis: true, render: (title: string, r: ExplorerCrsRow) => r.htmlUrl ? <a href={r.htmlUrl} target="_blank" rel="noreferrer">{title}</a> : title },
          { title: 'Topics', dataIndex: 'topics', width: 220, render: (t: string[]) => <ChipList items={t} max={3} /> },
          { title: 'Authors', dataIndex: 'authors', width: 140, render: (a: string[]) => a.length ? a.slice(0, 1).join(', ') + (a.length > 1 ? ` +${a.length - 1}` : '') : '—' },
          { title: 'Date', dataIndex: 'date', width: 110, render: (d: string | null) => d ? <span className="num">{formatDate(d)}</span> : '—' },
        ]}
      />
    </>
  );
}

/* ── FEC contributions ──────────────────────────────────────────────────── */

function FecExplorer({ onRowClick }: { onRowClick: (id: string, row: ExplorerFecRow) => void }) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [cycles, setCycles] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [minAmount, setMinAmount] = useState<string>('');
  const [sort, setSort] = useState('amount');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, cycles, states, minAmount, sort]);

  const facets = useQuery<FecFacets>({
    queryKey: ['explorer-fec-facets'],
    queryFn: async () => (await api.get<FecFacets>('/api/explorer/fec-facets')).data,
    staleTime: 10 * 60 * 1000,
  });
  const rowsQuery = useQuery<ExplorerResponse<ExplorerFecRow>>({
    queryKey: ['explorer-fec', q, cycles, states, minAmount, sort, page],
    queryFn: async () => (await api.get<ExplorerResponse<ExplorerFecRow>>('/api/explorer/fec-contributions', {
      params: {
        q: q || undefined,
        cycles: cycles.length ? cycles.join(',') : undefined,
        states: states.length ? states.join(',') : undefined,
        minAmount: minAmount && Number(minAmount) > 0 ? Number(minAmount) : undefined,
        sort,
        page,
        pageSize: PAGE_SIZE,
      },
    })).data,
    placeholderData: (p) => p,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search contributor, employer, candidate or committee…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => { setSearchInput(''); setQ(''); }}
        controls={
          <>
            <MultiSelect label="Cycle" placeholder="Any" options={(facets.data?.cycles ?? []).map((c) => ({ value: String(c), label: String(c) }))} values={cycles} onChange={setCycles} loading={facets.isLoading} />
            <MultiSelect label="State" placeholder="Any" options={(facets.data?.states ?? []).map((s) => ({ value: s, label: s }))} values={states} onChange={setStates} loading={facets.isLoading} />
            <label className="explorer-filter">
              <span className="explorer-filter-label">Min amount ($)</span>
              <Input
                style={{ width: 130 }}
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="0"
              />
            </label>
            <SortControl value={sort} onChange={setSort} options={[
              { value: 'amount', label: 'Largest amount' },
              { value: 'date', label: 'Most recent' },
            ]} />
          </>
        }
      />
      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          { title: 'Date', dataIndex: 'contributionDate', width: 100, render: (d: string | null) => d ? <span className="num">{formatDate(d)}</span> : '—' },
          { title: 'Contributor', dataIndex: 'contributorName', ellipsis: true, render: (n: string | null, r: ExplorerFecRow) => (
            <span>
              <span>{n ?? '—'}</span>
              {r.contributorEmployer ? <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)' }}>{r.contributorEmployer}</span> : null}
            </span>
          ) },
          { title: 'Recipient', dataIndex: 'committeeName', ellipsis: true, render: (n: string | null, r: ExplorerFecRow) => (
            <span>
              <span>{n ?? '—'}</span>
              {r.candidateName ? <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)' }}>for {r.candidateName}</span> : null}
            </span>
          ) },
          { title: 'Amount', dataIndex: 'amount', width: 110, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 500 }}>{formatMoney(v)}</span> },
          { title: 'State', dataIndex: 'state', width: 70, render: (s: string | null) => s ? <span className="state-pill num">{s}</span> : '—' },
          { title: 'Cycle', dataIndex: 'cycle', width: 80, render: (c: number) => <span className="num">{c}</span> },
        ]}
      />
    </>
  );
}

/* ── FARA registrations ─────────────────────────────────────────────────── */

function FaraExplorer({ onRowClick }: { onRowClick: (id: string, row: ExplorerFaraRow) => void }) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [countries, setCountries] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, countries, statuses, sort]);

  const facets = useQuery<FaraFacets>({
    queryKey: ['explorer-fara-facets'],
    queryFn: async () => (await api.get<FaraFacets>('/api/explorer/fara-facets')).data,
    staleTime: 10 * 60 * 1000,
  });
  const rowsQuery = useQuery<ExplorerResponse<ExplorerFaraRow>>({
    queryKey: ['explorer-fara', q, countries, statuses, sort, page],
    queryFn: async () => (await api.get<ExplorerResponse<ExplorerFaraRow>>('/api/explorer/fara', {
      params: { q: q || undefined, countries: countries.length ? countries.join(',') : undefined, statuses: statuses.length ? statuses.join(',') : undefined, sort, page, pageSize: PAGE_SIZE },
    })).data,
    placeholderData: (p) => p,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search registrant or foreign principal…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => { setSearchInput(''); setQ(''); }}
        controls={
          <>
            <MultiSelect label="Country" placeholder="Any country" options={(facets.data?.countries ?? []).map((c) => ({ value: c, label: c }))} values={countries} onChange={setCountries} loading={facets.isLoading} />
            <MultiSelect label="Status" placeholder="Any" options={(facets.data?.statuses ?? []).map((s) => ({ value: s, label: s }))} values={statuses} onChange={setStatuses} loading={facets.isLoading} />
            <SortControl value={sort} onChange={setSort} options={[
              { value: 'recent', label: 'Most recent registration' },
              { value: 'oldest', label: 'Oldest first' },
            ]} />
          </>
        }
      />
      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          { title: 'Reg #', dataIndex: 'registrationNumber', width: 110, render: (r: string) => <span className="num" style={{ fontFamily: 'var(--font-mono-rd)', fontSize: 11 }}>{r}</span> },
          { title: 'Registrant', dataIndex: 'registrantName', ellipsis: true },
          { title: 'Foreign Principal', dataIndex: 'foreignPrincipal', ellipsis: true },
          { title: 'Country', dataIndex: 'country', width: 130, render: (c: string | null) => c ?? '—' },
          { title: 'Status', dataIndex: 'status', width: 110, render: (s: string | null) => s ? <Tag color={s.toLowerCase() === 'active' ? 'green' : 'default'}>{s}</Tag> : '—' },
          { title: 'Registered', dataIndex: 'registrationDate', width: 110, render: (d: string | null) => d ? <span className="num">{formatDate(d)}</span> : '—' },
        ]}
      />
    </>
  );
}

/* ── SEC filings ────────────────────────────────────────────────────────── */

function SecExplorer({ onRowClick }: { onRowClick: (id: string, row: ExplorerSecRow) => void }) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [formTypes, setFormTypes] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, formTypes]);

  const facets = useQuery<SecFacets>({
    queryKey: ['explorer-sec-facets'],
    queryFn: async () => (await api.get<SecFacets>('/api/explorer/sec-facets')).data,
    staleTime: 10 * 60 * 1000,
  });
  const rowsQuery = useQuery<ExplorerResponse<ExplorerSecRow>>({
    queryKey: ['explorer-sec', q, formTypes, page],
    queryFn: async () => (await api.get<ExplorerResponse<ExplorerSecRow>>('/api/explorer/sec', {
      params: { q: q || undefined, formTypes: formTypes.length ? formTypes.join(',') : undefined, page, pageSize: PAGE_SIZE },
    })).data,
    placeholderData: (p) => p,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search company or description…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => { setSearchInput(''); setQ(''); }}
        controls={
          <>
            <MultiSelect label="Form type" placeholder="Any" options={(facets.data?.formTypes ?? []).map((t) => ({ value: t, label: t }))} values={formTypes} onChange={setFormTypes} loading={facets.isLoading} />
          </>
        }
      />
      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          { title: 'Date', dataIndex: 'filingDate', width: 100, render: (d: string) => <span className="num">{formatDate(d)}</span> },
          { title: 'Form', dataIndex: 'formType', width: 90, render: (t: string) => <Tag className="redesign-mono-tag">{t}</Tag> },
          { title: 'Company', dataIndex: 'companyName', ellipsis: true },
          { title: 'Description', dataIndex: 'description', ellipsis: true },
          { title: 'CIK', dataIndex: 'cik', width: 110, render: (c: string) => <span className="num" style={{ fontFamily: 'var(--font-mono-rd)', fontSize: 11 }}>{c}</span> },
        ]}
      />
    </>
  );
}

/* ── Intel articles (news feed) ─────────────────────────────────────────── */

function ArticlesExplorer({ onRowClick }: { onRowClick: (id: string, row: ExplorerIntelArticleRow) => void }) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sources, setSources] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [agencies, setAgencies] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, sources, topics, agencies]);

  const facets = useQuery<IntelArticleFacets>({
    queryKey: ['explorer-article-facets'],
    queryFn: async () => (await api.get<IntelArticleFacets>('/api/explorer/intel-article-facets')).data,
    staleTime: 10 * 60 * 1000,
  });
  const rowsQuery = useQuery<ExplorerResponse<ExplorerIntelArticleRow>>({
    queryKey: ['explorer-articles', q, sources, topics, agencies, page],
    queryFn: async () => (await api.get<ExplorerResponse<ExplorerIntelArticleRow>>('/api/explorer/intel-articles', {
      params: { q: q || undefined, sources: sources.length ? sources.join(',') : undefined, topics: topics.length ? topics.join(',') : undefined, agencies: agencies.length ? agencies.join(',') : undefined, page, pageSize: PAGE_SIZE },
    })).data,
    placeholderData: (p) => p,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search article title or summary…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => { setSearchInput(''); setQ(''); }}
        controls={
          <>
            <MultiSelect label="Source" placeholder="Any" options={(facets.data?.sources ?? []).map((s) => ({ value: s, label: s }))} values={sources} onChange={setSources} loading={facets.isLoading} />
            <MultiSelect label="Topic" placeholder="Any topic" options={(facets.data?.topics ?? []).map((t) => ({ value: t, label: t }))} values={topics} onChange={setTopics} loading={facets.isLoading} />
            <MultiSelect label="Agency" placeholder="Any agency" options={(facets.data?.agencies ?? []).map((a) => ({ value: a, label: a }))} values={agencies} onChange={setAgencies} loading={facets.isLoading} />
          </>
        }
      />
      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          { title: 'Published', dataIndex: 'publishedAt', width: 130, render: (d: string) => <span className="num">{formatDate(d)}</span> },
          { title: 'Source', dataIndex: 'source', width: 140, render: (s: string) => <Tag className="redesign-mono-tag">{s}</Tag> },
          { title: 'Title', dataIndex: 'title', ellipsis: true, render: (t: string, r: ExplorerIntelArticleRow) => <a href={r.url} target="_blank" rel="noreferrer">{t}</a> },
          { title: 'Topics', dataIndex: 'topics', width: 200, render: (t: string[]) => <ChipList items={t} max={3} /> },
        ]}
      />
    </>
  );
}

/* ── State bills ────────────────────────────────────────────────────────── */

function StateBillsExplorer({ onRowClick }: { onRowClick: (id: string, row: ExplorerStateBillRow) => void }) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [states, setStates] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [sponsorParty, setSponsorParty] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, states, subjects, sponsorParty]);

  const facets = useQuery<StateBillFacets>({
    queryKey: ['explorer-state-bill-facets'],
    queryFn: async () => (await api.get<StateBillFacets>('/api/explorer/state-bill-facets')).data,
    staleTime: 10 * 60 * 1000,
  });
  const rowsQuery = useQuery<ExplorerResponse<ExplorerStateBillRow>>({
    queryKey: ['explorer-state-bills', q, states, subjects, sponsorParty, page],
    queryFn: async () => (await api.get<ExplorerResponse<ExplorerStateBillRow>>('/api/explorer/state-bills', {
      params: { q: q || undefined, states: states.length ? states.join(',') : undefined, subjects: subjects.length ? subjects.join(',') : undefined, sponsorParty: sponsorParty.length ? sponsorParty.join(',') : undefined, page, pageSize: PAGE_SIZE },
    })).data,
    placeholderData: (p) => p,
  });

  return (
    <>
      <ExplorerFilterBar
        searchPlaceholder="Search bill title or sponsor…"
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onSearchSubmit={() => setQ(searchInput.trim())}
        onClearSearch={() => { setSearchInput(''); setQ(''); }}
        controls={
          <>
            <MultiSelect label="State" placeholder="Any" options={(facets.data?.states ?? []).map((s) => ({ value: s, label: s }))} values={states} onChange={setStates} loading={facets.isLoading} />
            <MultiSelect label="Subject" placeholder="Any subject" options={(facets.data?.subjects ?? []).map((s) => ({ value: s, label: s }))} values={subjects} onChange={setSubjects} loading={facets.isLoading} />
            <MultiSelect label="Sponsor party" placeholder="Any" options={(facets.data?.parties ?? []).map((p) => ({ value: p, label: p }))} values={sponsorParty} onChange={setSponsorParty} loading={facets.isLoading} />
          </>
        }
      />
      <ExplorerTable
        loading={rowsQuery.isLoading}
        rows={rowsQuery.data?.rows ?? []}
        total={rowsQuery.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        rowKey="id"
        onRowClick={onRowClick}
        columns={[
          { title: 'State', dataIndex: 'state', width: 70, render: (s: string) => <span className="state-pill num">{s}</span> },
          { title: 'Bill', dataIndex: 'identifier', width: 100, render: (id: string) => <span className="num" style={{ fontWeight: 600 }}>{id}</span> },
          { title: 'Title', dataIndex: 'title', ellipsis: true },
          { title: 'Sponsor', dataIndex: 'sponsorName', width: 180, render: (n: string | null, r: ExplorerStateBillRow) => n ? (
            <span>
              {n}
              {r.sponsorParty ? <span style={{ marginLeft: 6, fontSize: 10.5, fontFamily: 'var(--font-mono-rd)', color: 'var(--ink-3)' }}>({r.sponsorParty})</span> : null}
            </span>
          ) : '—' },
          { title: 'Latest action', dataIndex: 'latestActionText', ellipsis: true, render: (text: string | null, r: ExplorerStateBillRow) => (
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 12.5 }}>{text ?? '—'}</span>
              {r.latestActionDate ? <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{formatDate(r.latestActionDate)}</span> : null}
            </span>
          ) },
        ]}
      />
    </>
  );
}

/* ── Drill-in drawer ────────────────────────────────────────────────────── */

function ExplorerDrillInDrawer({
  drillIn,
  onClose,
}: {
  drillIn: DrillIn;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={drillIn !== null}
      onClose={onClose}
      width={Math.min(640, typeof window !== 'undefined' ? window.innerWidth - 60 : 640)}
      destroyOnClose
      title={
        drillIn ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {SOURCES.find((s) => s.key === drillIn.source)?.label}
            </span>
            <span style={{ color: 'var(--ink-4)' }}>·</span>
            <span style={{ fontWeight: 600, color: 'var(--ink-1)' }}>{drillIn.rowSummary}</span>
          </span>
        ) : null
      }
      className="explorer-drill-drawer"
    >
      {drillIn ? <DrillInContent drillIn={drillIn} /> : null}
    </Drawer>
  );
}

function DrillInContent({ drillIn }: { drillIn: NonNullable<DrillIn> }) {
  if (drillIn.source === 'lda') return <LdaFilingDetailView id={drillIn.id} />;
  if (drillIn.source === 'bills') return <BillDetailView id={drillIn.id} />;
  if (drillIn.source === 'contractors') return <ContractorDetailView id={drillIn.id} />;
  if (drillIn.source === 'fedreg') return <FedRegDetailView id={drillIn.id} />;
  return (
    <div style={{ padding: 24, fontSize: 12.5, color: 'var(--ink-3)' }}>
      Detailed view for this source isn't wired yet. The full row data is available via the table.
    </div>
  );
}

function LdaFilingDetailView({ id }: { id: string }) {
  const api = useApi();
  const query = useQuery<LdaFilingDetail | null>({
    queryKey: ['explorer-lda-detail', id],
    queryFn: async () => (await api.get<LdaFilingDetail>(`/api/explorer/lda-filings/${id}`)).data,
  });
  if (query.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (!query.data) return <Empty description="Filing not found." />;
  const { filing, registrantRecent, clientRecent, issueCodes } = query.data;
  return (
    <div className="drill-content">
      <DrillSection title="Filing">
        <DrillKV label="Filing UUID" value={<span className="num">{filing.filingUuid}</span>} />
        <DrillKV label="Type" value={filing.filingType} />
        <DrillKV label="Year / period" value={`${filing.filingYear}${filing.filingPeriod ? ` · ${filing.filingPeriod}` : ''}`} />
        <DrillKV label="Posted" value={filing.dtPosted ? formatDate(filing.dtPosted) : '—'} />
        <DrillKV label="Income" value={<span className="num">{formatMoney(filing.income)}</span>} />
        <DrillKV label="Expenses" value={<span className="num">{formatMoney(filing.expenses ?? null)}</span>} />
        <DrillKV label="Registrant" value={filing.registrantName} />
        <DrillKV label="Client" value={`${filing.clientName}${filing.clientState ? ` (${filing.clientState})` : ''}`} />
      </DrillSection>

      {issueCodes.length ? (
        <DrillSection title="Issue codes">
          <ul className="drill-list">
            {issueCodes.map((c) => (
              <li key={c.code}>
                <Tag className="redesign-mono-tag">{c.code}</Tag>
                <span>{c.name}</span>
              </li>
            ))}
          </ul>
        </DrillSection>
      ) : null}

      {registrantRecent.length ? (
        <DrillSection title={`Other recent filings by ${filing.registrantName}`}>
          <ul className="drill-list">
            {registrantRecent.map((r) => (
              <li key={r.id}>
                <span className="num">{r.filingYear}{r.filingPeriod ? ` · ${r.filingPeriod}` : ''}</span>
                <span>{r.clientName}</span>
                <span className="num drill-amount">{formatMoney(r.income)}</span>
              </li>
            ))}
          </ul>
        </DrillSection>
      ) : null}

      {clientRecent.length ? (
        <DrillSection title={`Other lobbying for ${filing.clientName}`}>
          <ul className="drill-list">
            {clientRecent.map((r) => (
              <li key={r.id}>
                <span className="num">{r.filingYear}{r.filingPeriod ? ` · ${r.filingPeriod}` : ''}</span>
                <span>{r.registrantName}</span>
                <span className="num drill-amount">{formatMoney(r.income)}</span>
              </li>
            ))}
          </ul>
        </DrillSection>
      ) : null}
    </div>
  );
}

function BillDetailView({ id }: { id: string }) {
  const api = useApi();
  const query = useQuery<BillDetail | null>({
    queryKey: ['explorer-bill-detail', id],
    queryFn: async () => (await api.get<BillDetail>(`/api/explorer/congress-bills/${id}`)).data,
  });
  if (query.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (!query.data) return <Empty description="Bill not found." />;
  const { bill } = query.data;
  return (
    <div className="drill-content">
      <DrillSection title="Bill">
        <DrillKV label="Number" value={<span className="num" style={{ fontWeight: 600 }}>{bill.billType} {bill.billNumber}</span>} />
        <DrillKV label="Congress" value={`${bill.congress}th`} />
        <DrillKV label="Title" value={bill.title} />
        <DrillKV label="Sponsor" value={`${bill.sponsorName ?? '—'}${bill.sponsorParty ? ` (${bill.sponsorParty}-${bill.sponsorState ?? ''})` : ''}`} />
        <DrillKV label="Introduced" value={bill.introducedDate ? formatDate(bill.introducedDate) : '—'} />
        <DrillKV label="Origin chamber" value={bill.originChamber ?? '—'} />
        <DrillKV label="Policy area" value={bill.policyArea ?? '—'} />
        <DrillKV label="Cosponsors" value={<span className="num">{bill.cosponsorsCount}</span>} />
        <DrillKV label="Latest action" value={
          <span>
            {bill.latestActionText ?? '—'}
            {bill.latestActionDate ? <span className="num" style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)' }}>{formatDate(bill.latestActionDate)}</span> : null}
          </span>
        } />
        {bill.url ? <DrillKV label="Congress.gov" value={<a href={bill.url} target="_blank" rel="noreferrer">View on Congress.gov →</a>} /> : null}
      </DrillSection>

      {bill.subjects.length ? (
        <DrillSection title="Subjects">
          <ChipList items={bill.subjects} max={20} />
        </DrillSection>
      ) : null}

      {bill.actions.length ? (
        <DrillSection title="Recent actions">
          <ul className="drill-list">
            {bill.actions.map((a) => (
              <li key={a.id}>
                <span className="num">{formatDate(a.date)}</span>
                <span>{a.text}</span>
                {a.chamber ? <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{a.chamber}</span> : null}
              </li>
            ))}
          </ul>
        </DrillSection>
      ) : null}
    </div>
  );
}

function ContractorDetailView({ id }: { id: string }) {
  const api = useApi();
  const query = useQuery<ContractorDetail | null>({
    queryKey: ['explorer-contractor-detail', id],
    queryFn: async () => (await api.get<ContractorDetail>(`/api/explorer/federal-contractors/${id}`)).data,
  });
  if (query.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (!query.data) return <Empty description="Contractor not found." />;
  const { contractor } = query.data;
  return (
    <div className="drill-content">
      <DrillSection title="Contractor">
        <DrillKV label="Name" value={contractor.name} />
        <DrillKV label="UEI" value={contractor.uei ? <span className="num" style={{ fontFamily: 'var(--font-mono-rd)' }}>{contractor.uei}</span> : '—'} />
        <DrillKV label="Category" value={contractor.category ?? '—'} />
        <DrillKV label="Rank" value={contractor.rankByContracts ? `#${contractor.rankByContracts}` : '—'} />
        <DrillKV label="Total contracts" value={<span className="num">{formatMoney(contractor.totalContracts)}</span>} />
        <DrillKV label="No-bid total" value={<span className="num" style={{ color: contractor.noBidTotal && contractor.noBidTotal > 0 ? 'var(--critical)' : 'var(--ink-3)' }}>{formatMoney(contractor.noBidTotal)}</span>} />
      </DrillSection>

      {contractor.topAgencies?.length ? (
        <DrillSection title="Top agencies">
          <ul className="drill-list">
            {contractor.topAgencies.slice(0, 10).map((a, i) => (
              <li key={i}>
                <span>{a.name}</span>
                <span className="num drill-amount">{formatMoney(a.amount)}</span>
              </li>
            ))}
          </ul>
        </DrillSection>
      ) : null}

      {contractor.yearlySpend?.length ? (
        <DrillSection title="Yearly spend">
          <ul className="drill-list">
            {contractor.yearlySpend.slice(0, 8).map((y) => (
              <li key={y.year}>
                <span className="num">{y.year}</span>
                <span className="num drill-amount">{formatMoney(y.amount)}</span>
              </li>
            ))}
          </ul>
        </DrillSection>
      ) : null}
    </div>
  );
}

function FedRegDetailView({ id }: { id: string }) {
  const api = useApi();
  const query = useQuery<FedRegDetail | null>({
    queryKey: ['explorer-fed-reg-detail', id],
    queryFn: async () => (await api.get<FedRegDetail>(`/api/explorer/federal-register/${id}`)).data,
  });
  if (query.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (!query.data) return <Empty description="Document not found." />;
  const { document } = query.data;
  return (
    <div className="drill-content">
      <DrillSection title="Document">
        <DrillKV label="Title" value={document.title} />
        <DrillKV label="Type" value={document.type.replace(/_/g, ' ')} />
        <DrillKV label="Doc #" value={<span className="num">{document.documentNumber}</span>} />
        <DrillKV label="Agency" value={document.agencyNames.join(' / ')} />
        <DrillKV label="Published" value={formatDate(document.publicationDate)} />
        <DrillKV label="Comment closes" value={document.commentEndDate ? formatDate(document.commentEndDate) : '—'} />
        <DrillKV label="Effective" value={document.effectiveDate ? formatDate(document.effectiveDate) : '—'} />
        <DrillKV label="Significant rule" value={document.significantRule ? 'Yes' : 'No'} />
        {document.htmlUrl ? <DrillKV label="Federal Register" value={<a href={document.htmlUrl} target="_blank" rel="noreferrer">View on FederalRegister.gov →</a>} /> : null}
      </DrillSection>

      {document.abstract ? (
        <DrillSection title="Abstract">
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-1)' }}>{document.abstract}</p>
        </DrillSection>
      ) : null}

      {document.topics?.length ? (
        <DrillSection title="Topics">
          <ChipList items={document.topics} max={20} />
        </DrillSection>
      ) : null}
    </div>
  );
}

function DrillSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="drill-section">
      <h3 className="drill-section-title">{title}</h3>
      {children}
    </section>
  );
}

function DrillKV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="drill-kv">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}

function ChipList({ items, max }: { items: string[]; max: number }) {
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {items.slice(0, max).map((it) => (
        <Tag key={it} className="redesign-mono-tag">
          {it}
        </Tag>
      ))}
      {items.length > max ? <Tag>+{items.length - max}</Tag> : null}
    </span>
  );
}

/* ── Shared bits ─────────────────────────────────────────────────────────── */

function ExplorerFilterBar({
  searchPlaceholder,
  searchInput,
  onSearchInput,
  onSearchSubmit,
  onClearSearch,
  controls,
}: {
  searchPlaceholder: string;
  searchInput: string;
  onSearchInput: (value: string) => void;
  onSearchSubmit: () => void;
  onClearSearch: () => void;
  controls: ReactNode;
}) {
  return (
    <div className="explorer-filter-bar">
      <Input
        allowClear
        size="large"
        prefix={<SearchOutlined />}
        value={searchInput}
        placeholder={searchPlaceholder}
        onChange={(event) => onSearchInput(event.target.value)}
        onPressEnter={onSearchSubmit}
        onClear={onClearSearch}
        className="explorer-search-input"
      />
      <div className="explorer-filter-controls">{controls}</div>
    </div>
  );
}

function MultiSelect({
  label,
  placeholder,
  options,
  values,
  onChange,
  loading,
}: {
  label: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  values: string[];
  onChange: (values: string[]) => void;
  loading?: boolean;
}) {
  return (
    <label className="explorer-filter">
      <span className="explorer-filter-label">{label}</span>
      <Select
        mode="multiple"
        allowClear
        maxTagCount="responsive"
        placeholder={placeholder}
        options={options}
        value={values}
        loading={loading}
        onChange={(next) => onChange(next as string[])}
        style={{ minWidth: 160 }}
      />
    </label>
  );
}

function SortControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="explorer-filter">
      <span className="explorer-filter-label">Sort</span>
      <Select
        options={options}
        value={value}
        onChange={(next) => onChange(next as string)}
        style={{ minWidth: 180 }}
      />
    </label>
  );
}

function ToggleChip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`explorer-toggle-chip${active ? ' is-active' : ''}`}
      onClick={onToggle}
    >
      <span className="explorer-toggle-checkbox" aria-hidden>
        {active ? '✓' : ''}
      </span>
      {label}
    </button>
  );
}

function ExplorerTable<T extends { id: string }>({
  loading,
  rows,
  total,
  page,
  onPageChange,
  rowKey,
  columns,
  onRowClick,
}: {
  loading: boolean;
  rows: T[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  rowKey: keyof T;
  columns: Parameters<typeof Table<T>>[0]['columns'];
  onRowClick?: (id: string, row: T) => void;
}) {
  if (loading && rows.length === 0) {
    return (
      <div className="explorer-table-shell">
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="explorer-table-shell explorer-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No rows match these filters." />
      </div>
    );
  }

  return (
    <div className="explorer-table-shell">
      <div className="explorer-table-meta">
        <Typography.Text type="secondary">
          {total.toLocaleString()} row{total === 1 ? '' : 's'} · showing{' '}
          {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}
        </Typography.Text>
      </div>
      <Table<T>
        size="middle"
        rowKey={rowKey as string}
        dataSource={rows}
        columns={columns}
        pagination={false}
        loading={loading}
        onRow={(record) =>
          onRowClick
            ? {
                onClick: () => onRowClick(record.id, record),
                style: { cursor: 'pointer' },
              }
            : {}
        }
      />
      {total > PAGE_SIZE ? (
        <div className="explorer-pagination">
          <Pagination
            current={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={onPageChange}
            showSizeChanger={false}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ── Formatters ──────────────────────────────────────────────────────────── */

function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function partyName(short: string): string {
  if (short === 'D') return 'Democrat';
  if (short === 'R') return 'Republican';
  if (short === 'I') return 'Independent';
  return short;
}

const _placeholder = useMemo;
void _placeholder;
