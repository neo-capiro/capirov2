import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import React from 'react';
import { PeReconciliationPage } from './PeReconciliationPage.js';

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

function openEntry(over: Record<string, unknown> = {}) {
  return {
    id: 'rq1',
    peCode: '0601102A',
    fy: 2027,
    fieldName: 'hascMark',
    currentValue: '100',
    conflictingSource: 'sasc_report',
    conflictingValue: '250.5',
    deltaPct: 0.6,
    queuedAt: '2026-06-07T12:00:00.000Z',
    status: 'open',
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

describe('PeReconciliationPage', () => {
  beforeAll(setupAntdBrowserMocks);
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
  });

  test('renders resolve controls + status filter for open conflicts', async () => {
    apiGetMock.mockResolvedValue({ data: { data: [openEntry()], total: 1, page: 1, limit: 25 } });

    renderWithClient(<PeReconciliationPage />);

    expect(await screen.findByText('0601102A')).toBeInTheDocument();
    // Resolve controls present.
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manual…' })).toBeInTheDocument();
    // Status filter present + queue queried with the default 'open' status.
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(apiGetMock).toHaveBeenCalledWith(
      '/api/program-elements/admin/reconciliation-queue',
      expect.objectContaining({ params: { status: 'open' } }),
    );
  });

  test('Keep resolves via POST with decision=keep_current', async () => {
    apiGetMock.mockResolvedValue({ data: { data: [openEntry()], total: 1, page: 1, limit: 25 } });
    apiPostMock.mockResolvedValue({ data: { resolved: true } });

    renderWithClient(<PeReconciliationPage />);
    await screen.findByText('0601102A');

    // Click the Keep trigger, then confirm in the Popconfirm popover.
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep' })[0]!);
    const keepButtons = await screen.findAllByRole('button', { name: 'Keep' });
    fireEvent.click(keepButtons[keepButtons.length - 1]!);

    await waitFor(() => expect(apiPostMock).toHaveBeenCalled());
    expect(apiPostMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/program-elements/admin/reconciliation-queue/rq1/resolve'),
      expect.objectContaining({ decision: 'keep_current' }),
    );
  });

  test('Accept resolves via POST with decision=accept_conflicting', async () => {
    apiGetMock.mockResolvedValue({ data: { data: [openEntry()], total: 1, page: 1, limit: 25 } });
    apiPostMock.mockResolvedValue({ data: { resolved: true } });

    renderWithClient(<PeReconciliationPage />);
    await screen.findByText('0601102A');

    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0]!);
    const acceptButtons = await screen.findAllByRole('button', { name: 'Accept' });
    fireEvent.click(acceptButtons[acceptButtons.length - 1]!);

    await waitFor(() => expect(apiPostMock).toHaveBeenCalled());
    expect(apiPostMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/program-elements/admin/reconciliation-queue/rq1/resolve'),
      expect.objectContaining({ decision: 'accept_conflicting' }),
    );
  });

  test('Manual… opens a value-entry modal', async () => {
    apiGetMock.mockResolvedValue({ data: { data: [openEntry()], total: 1, page: 1, limit: 25 } });

    renderWithClient(<PeReconciliationPage />);
    await screen.findByText('0601102A');

    fireEvent.click(screen.getByRole('button', { name: 'Manual…' }));
    expect(await screen.findByText('Value ($ millions)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply value' })).toBeInTheDocument();
  });

  test('resolved rows show a status tag instead of resolve controls', async () => {
    apiGetMock.mockResolvedValue({
      data: { data: [openEntry({ id: 'rq2', status: 'resolved' })], total: 1, page: 1, limit: 25 },
    });

    renderWithClient(<PeReconciliationPage />);
    await screen.findByText('0601102A');
    expect(screen.queryByRole('button', { name: 'Keep' })).not.toBeInTheDocument();
    expect(screen.getByText('resolved')).toBeInTheDocument();
  });
});
