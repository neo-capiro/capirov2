import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DowDirectoryTab } from './DowDirectoryTab.js';
import type { AcquisitionPersonnelListItem } from '../program-element/types.js';

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
vi.mock('../../lib/use-api.js', () => ({
  useApi: () => ({ get: apiGetMock, post: vi.fn() }),
}));

function person(over: Partial<AcquisitionPersonnelListItem> = {}): AcquisitionPersonnelListItem {
  return {
    id: 'p1',
    fullName: 'Jane Smith',
    service: 'ARMY',
    organization: 'PEO Aviation',
    title: 'Program Manager',
    role: 'PM',
    pePrimary: '0604201A',
    peSecondary: [],
    emailDomain: 'army.mil',
    publicProfileUrl: null,
    confidence: 0.97,
    status: 'active',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-05-30T00:00:00.000Z',
    sourceCount: 3,
    ...over,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('DowDirectoryTab', () => {
  beforeAll(setupAntdBrowserMocks);
  beforeEach(() => apiGetMock.mockReset());

  test('renders personnel for the client PE codes', async () => {
    apiGetMock.mockResolvedValue({
      data: { data: [person(), person({ id: 'p2', fullName: 'Bob Jones', role: 'KO' })], total: 2, page: 1, limit: 100 },
    });
    renderWithClient(
      <DowDirectoryTab client={{ id: 'c1' }} capabilities={[{ peNumber: '0604201A' }]} />,
    );
    expect(await screen.findByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    // queried the list endpoint with the client's PE code
    expect(apiGetMock).toHaveBeenCalledWith(
      '/api/acquisition-personnel',
      expect.objectContaining({ params: expect.objectContaining({ pe_code: '0604201A' }) }),
    );
  });

  test('empty state when client has no PE-code capabilities', () => {
    renderWithClient(<DowDirectoryTab client={{ id: 'c1' }} capabilities={[{ peNumber: null }, {}]} />);
    expect(
      screen.getByText('No defense program capabilities linked to this client yet'),
    ).toBeInTheDocument();
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  test('role filter narrows the visible list', async () => {
    apiGetMock.mockResolvedValue({
      data: {
        data: [person({ id: 'p1', fullName: 'Jane Smith', role: 'PM' }), person({ id: 'p2', fullName: 'Bob Jones', role: 'KO' })],
        total: 2,
        page: 1,
        limit: 100,
      },
    });
    renderWithClient(<DowDirectoryTab client={{ id: 'c1' }} capabilities={[{ peNumber: '0604201A' }]} />);
    expect(await screen.findByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();

    // Open the role Select and choose KO -> only Bob (role KO) remains.
    // antd Select renders options in a portal; drive it via the combobox role
    // and click the actual option node (matched by title) rather than bare
    // text, which is timing-flaky under jsdom. The role Select is the 2nd
    // combobox (after the service Select).
    const comboboxes = screen.getAllByRole('combobox');
    const roleCombobox = comboboxes[1] ?? comboboxes[0];
    expect(roleCombobox).toBeDefined();
    fireEvent.mouseDown(roleCombobox as HTMLElement);

    const koOption = await screen.findByTitle('KO');
    fireEvent.click(koOption);

    await waitFor(() => {
      expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });
});
