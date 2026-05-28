import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProgramElementWatchPage } from './ProgramElementWatchPage.js';

const apiGetMock = vi.fn();

vi.mock('../../lib/use-api.js', () => ({
  useApi: () => ({
    get: apiGetMock,
  }),
}));

describe('ProgramElementWatchPage', () => {
  test('renders without errors given mocked response', async () => {
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

    apiGetMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/program-elements/0603270A/contractors')) {
        return { data: { data: [], todo: 'federal_award table not yet created (Step 28)' } };
      }
      if (url.includes('/api/program-elements/0603270A/bills')) {
        return { data: [] };
      }
      if (url.includes('/api/program-elements') && !url.includes('/0603270A')) {
        return { data: { data: [], total: 0, page: 1, limit: 25 } };
      }
      return {
        data: {
          peCode: '0603270A',
          title: 'Electronic Warfare Advanced Payloads',
          service: 'Army',
          budgetActivity: 'BA3',
          appropriationType: 'RDT&E',
          status: 'active',
          firstSeenFy: 2023,
          lastSyncedAt: '2026-05-28T15:00:00.000Z',
          currentUserIsWatching: true,
          years: [
            {
              id: 'y1',
              fy: 2027,
              request: '278.50',
              conference: '301.00',
              enacted: '299.00',
            },
          ],
        },
      };
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/program-elements/0603270A']}>
          <Routes>
            <Route path="/program-elements/:peCode" element={<ProgramElementWatchPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText(/0603270A/i)).toBeInTheDocument());

    expect(screen.getByText(/Electronic Warfare Advanced Payloads/i)).toBeInTheDocument();
    expect(screen.getByText(/Army/i)).toBeInTheDocument();
    expect(await screen.findByText(/Timeline \(coming soon\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Bills \(coming soon\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Contractors \(coming soon\)/i)).toBeInTheDocument();
  });
});
