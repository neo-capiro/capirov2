import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import React from 'react';
import { AnalystConsolePage } from './AnalystConsolePage.js';

function setupAntdBrowserMocks() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
const apiPatchMock = vi.fn();
const apiDeleteMock = vi.fn();
vi.mock('../../lib/use-api.js', () => ({
  useApi: () => ({ get: apiGetMock, post: apiPostMock, patch: apiPatchMock, delete: apiDeleteMock }),
}));
vi.mock('../../lib/me.js', () => ({
  useMe: () => ({ data: { role: 'capiro_admin' }, isLoading: false }),
}));

const REVIEW_COUNTS = {
  reconciliation: { openCount: 4, oldestOpenAt: '2026-06-04T12:00:00.000Z' },
  programMatch: { openCount: 2, quarantinedCount: 1, oldestOpenAt: '2026-06-07T12:00:00.000Z' },
  personCandidate: { openCount: 3, oldestOpenAt: '2026-06-06T12:00:00.000Z' },
  personnelMerge: { openCount: 0, oldestOpenAt: null },
  provisionPeLink: { candidateCount: 5, oldestOpenAt: '2026-06-05T12:00:00.000Z' },
  programQuarantine: { count: 7 },
  personnelQuarantine: { count: 0 },
};

const QUARANTINE_RESPONSE = {
  data: [
    {
      id: 'q1',
      rawRecord: { peCode: 'BAD', title: 'x' },
      reason: 'Invalid pe_code: BAD',
      source: 'pdoc_fy2027',
      quarantinedAt: '2026-06-07T12:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
};

const AUDIT_RESPONSE = {
  data: [
    {
      id: 'a1',
      actorUserId: 'u1',
      actorRole: 'capiro_admin',
      action: 'program.merge',
      entityType: 'program',
      entityId: 'prog-2',
      before: { mergeProgramId: 'prog-2' },
      after: { keepProgramId: 'prog-1' },
      occurredAt: '2026-06-07T12:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
};

const PROGRAM_SEARCH = {
  data: [{ id: 'prog-1', canonicalName: 'PATRIOT', component: 'ARMY', mdapCode: 'M001', status: 'active' }],
  total: 1,
  q: '',
};

const ALIASES = {
  programId: 'prog-1',
  data: [
    {
      id: 'al1',
      programId: 'prog-1',
      alias: 'Patriot Advanced Capability',
      aliasNormalized: 'PATRIOT ADVANCED CAPABILITY',
      aliasType: 'project_title',
      source: 'analyst',
      sourceUrl: null,
      confidence: 0.9,
    },
  ],
  total: 1,
};

const DUPLICATE_ALIASES = {
  data: [
    {
      aliasNormalized: 'PATRIOT',
      programs: [
        { programId: 'prog-1', canonicalName: 'PATRIOT', status: 'active', aliasId: 'al1' },
        { programId: 'prog-2', canonicalName: 'Patriot (dup)', status: 'active', aliasId: 'al2' },
      ],
    },
  ],
  total: 1,
};

/** Route GET calls to the right fixture by URL so every mounted tab self-fetches. */
function routeGet(url: string) {
  if (url === '/api/capiro-admin/review-counts') return Promise.resolve({ data: REVIEW_COUNTS });
  if (url === '/api/capiro-admin/quarantine') return Promise.resolve({ data: QUARANTINE_RESPONSE });
  if (url === '/api/capiro-admin/audit-logs') return Promise.resolve({ data: AUDIT_RESPONSE });
  if (url === '/api/programs') return Promise.resolve({ data: PROGRAM_SEARCH });
  if (url === '/api/programs/admin/duplicate-aliases') return Promise.resolve({ data: DUPLICATE_ALIASES });
  if (url.endsWith('/aliases')) return Promise.resolve({ data: ALIASES });
  // mounted review-queue pages
  return Promise.resolve({ data: { data: [], total: 0, page: 1, limit: 25 } });
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App>{ui}</App>
    </QueryClientProvider>,
  );
}

describe('AnalystConsolePage', () => {
  beforeAll(setupAntdBrowserMocks);
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    apiPatchMock.mockReset();
    apiDeleteMock.mockReset();
    apiGetMock.mockImplementation((url: string) => routeGet(url));
  });

  test('SLA header renders count badges + chips from mocked review-counts', async () => {
    renderWithClient(<AnalystConsolePage />);

    // Header SLA chips computed from review-counts. The visible text is split
    // across nodes inside each Tag, so assert on the single-node aria-label. The
    // "oldest …" age is time-relative, so match only the stable count prefix.
    expect(await screen.findByLabelText(/^Reconciliation 4 open/)).toBeInTheDocument();
    // PE→Program chip shows the open candidate count (2). Match on the count to
    // sidestep the non-ASCII arrow in the label.
    expect(screen.getByLabelText(/Program 2 open, oldest/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Provision links 5 open/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Personnel merge 0 open, oldest clear$/)).toBeInTheDocument();
    expect(screen.getByText('Program quarantine: 7')).toBeInTheDocument();
    expect(screen.getByText('Personnel quarantine: 0')).toBeInTheDocument();
    // Tab labels carry count badges. The Quarantine tab badge sums program (7)
    // + personnel (0) = 7 quarantined records — a value unique among the badges.
    expect(screen.getByLabelText('7 items')).toBeInTheDocument();
    expect(screen.getByText('Alias manager')).toBeInTheDocument();
    expect(screen.getByText('Audit log')).toBeInTheDocument();
    expect(screen.getByText('SAM')).toBeInTheDocument();
    expect(apiGetMock).toHaveBeenCalledWith('/api/capiro-admin/review-counts');
  });

  test('Quarantine tab renders rows + a Reprocess button', async () => {
    renderWithClient(<AnalystConsolePage />);
    await screen.findByText(/Reconciliation: 4 open/);

    fireEvent.click(screen.getByText('Quarantine'));

    expect(await screen.findByText('Invalid pe_code: BAD')).toBeInTheDocument();
    expect(screen.getByText('pdoc_fy2027')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reprocess' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    expect(apiGetMock).toHaveBeenCalledWith(
      '/api/capiro-admin/quarantine',
      expect.objectContaining({
        params: expect.objectContaining({ type: 'program_element', page: 1, limit: 25 }),
      }),
    );
  });

  test('Audit log tab renders rows from mocked audit-logs', async () => {
    renderWithClient(<AnalystConsolePage />);
    await screen.findByText(/Reconciliation: 4 open/);

    fireEvent.click(screen.getByText('Audit log'));

    expect(await screen.findByText('program.merge')).toBeInTheDocument();
    expect(screen.getByText('prog-2')).toBeInTheDocument();
    expect(apiGetMock).toHaveBeenCalledWith('/api/capiro-admin/audit-logs', expect.anything());
  });

  test('Alias manager renders aliases + a duplicate pair with a Merge affordance', async () => {
    renderWithClient(<AnalystConsolePage />);
    await screen.findByText(/Reconciliation: 4 open/);

    fireEvent.click(screen.getByText('Alias manager'));

    // Duplicate-alias detector renders the dup group + a merge affordance.
    // "PATRIOT" appears as both the normalized-alias group code and a program name,
    // so assert it's present (>=1) and lean on the unique dup-program name + button.
    expect((await screen.findAllByText('PATRIOT')).length).toBeGreaterThan(0);
    expect(screen.getByText('Patriot (dup)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge programs' })).toBeInTheDocument();
    expect(apiGetMock).toHaveBeenCalledWith('/api/programs/admin/duplicate-aliases');

    // Selecting a program lists its aliases.
    const combos = screen.getAllByRole('combobox');
    fireEvent.mouseDown(combos[0]!);
    fireEvent.click(await screen.findByText(/PATRIOT · MDAP M001 · ARMY/));
    expect(await screen.findByText('Patriot Advanced Capability')).toBeInTheDocument();
  });

  test('Reprocess posts to the reprocess endpoint and reports the rejection reason', async () => {
    apiPostMock.mockResolvedValue({ data: { reprocessed: true, accepted: false, reason: 'Invalid pe_code: BAD' } });
    renderWithClient(<AnalystConsolePage />);
    await screen.findByText(/Reconciliation: 4 open/);

    fireEvent.click(screen.getByText('Quarantine'));
    await screen.findByText('Invalid pe_code: BAD');

    fireEvent.click(screen.getByRole('button', { name: 'Reprocess' }));
    // Confirm in the Popconfirm popover.
    const confirmButtons = await screen.findAllByRole('button', { name: 'Reprocess' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(apiPostMock).toHaveBeenCalled());
    expect(apiPostMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/capiro-admin/quarantine/program_element/q1/reprocess'),
    );
  });
});
