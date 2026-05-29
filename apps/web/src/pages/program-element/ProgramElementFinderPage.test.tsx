import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ProgramElementFinderPage } from './ProgramElementFinderPage.js';

const apiGetMock = vi.fn();

vi.mock('../../lib/use-api.js', () => ({
  useApi: () => ({
    get: apiGetMock,
  }),
}));

function setupBrowserMocks() {
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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProgramElementFinderPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProgramElementFinderPage', () => {
  beforeEach(() => {
    setupBrowserMocks();
    apiGetMock.mockReset();
  });

  test('renders matching program elements', async () => {
    apiGetMock.mockResolvedValue({
      data: {
        data: [
          {
            peCode: '0603270A',
            title: 'Army Electronic Warfare Technology',
            service: 'ARMY',
            budgetActivity: '03',
            appropriationType: 'RDTE',
            status: 'active',
            lastSyncedAt: '2026-05-01T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
      },
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('0603270A')).toBeInTheDocument());
    expect(screen.getByText('Army Electronic Warfare Technology')).toBeInTheDocument();
  });

  test('passes the search term to the list endpoint', async () => {
    apiGetMock.mockResolvedValue({
      data: { data: [], total: 0, page: 1, limit: 50 },
    });

    renderPage();

    await waitFor(() => expect(apiGetMock).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText(/Search code or title/i), {
      target: { value: 'electronic warfare' },
    });

    await waitFor(() => {
      const lastCall = apiGetMock.mock.calls.at(-1);
      expect(lastCall?.[1]?.params?.q).toBe('electronic warfare');
    });
  });

  test('shows an empty state when nothing matches', async () => {
    apiGetMock.mockResolvedValue({
      data: { data: [], total: 0, page: 1, limit: 50 },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No program elements matched your search')).toBeInTheDocument();
    });
  });
});
