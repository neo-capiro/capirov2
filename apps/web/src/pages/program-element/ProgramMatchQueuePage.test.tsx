import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import React from 'react';
import { ProgramMatchQueuePage } from './ProgramMatchQueuePage.js';

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
vi.mock('../../lib/use-api.js', () => ({
  useApi: () => ({ get: apiGetMock, post: apiPostMock }),
}));
vi.mock('../../lib/me.js', () => ({
  useMe: () => ({ data: { role: 'capiro_admin' }, isLoading: false }),
}));

function candidateRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pm1',
    peCode: '0601102A',
    projectCode: null,
    programId: 'prog-1',
    score: 0.82,
    confidenceBand: 'medium',
    evidenceTier: 'exact_project_title',
    status: 'candidate',
    matchBasis: 'title trigram',
    whyShown: 'project title exact match + R-2A p.144',
    evidence: [{ kind: 'r2a', sourceUrl: 'http://x.pdf', pageNumber: 144, quote: 'Patriot' }],
    programElement: { peCode: '0601102A', title: 'Patriot Dev', service: 'Army' },
    program: { id: 'prog-1', canonicalName: 'PATRIOT', component: 'ARMY', mdapCode: 'M001' },
    createdAt: '2026-06-07T12:00:00.000Z',
    ...over,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App>{ui}</App>
    </QueryClientProvider>,
  );
}

describe('ProgramMatchQueuePage', () => {
  beforeAll(setupAntdBrowserMocks);
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
  });

  test('renders resolve controls + why-shown + status filter for candidates', async () => {
    apiGetMock.mockResolvedValue({ data: { data: [candidateRow()], total: 1, page: 1, limit: 200 } });

    renderWithClient(<ProgramMatchQueuePage />);

    expect(await screen.findByText('PATRIOT')).toBeInTheDocument();
    // Why-shown evidence line rendered.
    expect(screen.getByText('project title exact match + R-2A p.144')).toBeInTheDocument();
    // Resolve controls present.
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quarantine' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    // Status filter present + queue queried with the default 'candidate' status.
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(apiGetMock).toHaveBeenCalledWith(
      '/api/programs/admin/match-queue',
      expect.objectContaining({ params: { status: 'candidate', limit: 200 } }),
    );
  });

  test('Accept resolves via POST to the resolve endpoint with decision=accept', async () => {
    apiGetMock.mockResolvedValue({ data: { data: [candidateRow()], total: 1, page: 1, limit: 200 } });
    apiPostMock.mockResolvedValue({ data: { resolved: true, id: 'pm1', status: 'accepted', decision: 'accept' } });

    renderWithClient(<ProgramMatchQueuePage />);
    await screen.findByText('PATRIOT');

    // Click the Accept trigger, then confirm in the Popconfirm popover.
    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0]!);
    const acceptButtons = await screen.findAllByRole('button', { name: 'Accept' });
    fireEvent.click(acceptButtons[acceptButtons.length - 1]!);

    await waitFor(() => expect(apiPostMock).toHaveBeenCalled());
    expect(apiPostMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/programs/admin/match-queue/pm1/resolve'),
      expect.objectContaining({ decision: 'accept' }),
    );
  });

  test('shows an honest empty state when the queue is clear', async () => {
    apiGetMock.mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 200 } });

    renderWithClient(<ProgramMatchQueuePage />);

    expect(await screen.findByText('No candidate matches.')).toBeInTheDocument();
  });
});
