import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { AiKeysAdminPanel } from './AiKeysAdminPanel.js';

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
const apiDeleteMock = vi.fn();
vi.mock('../../lib/use-api.js', () => ({
  useApi: () => ({ get: apiGetMock, post: apiPostMock, delete: apiDeleteMock }),
}));

const TENANT_A = '00000000-0000-0000-0000-0000000000a1';
const TENANT_B = '00000000-0000-0000-0000-0000000000b1';
const TENANT_C = '00000000-0000-0000-0000-0000000000c1';

// The roster (all tenants, from /capiro-admin/tenants) — Charlie has never
// generated anything and must STILL get a row + Manage button.
const TENANT_LIST = [
  { id: TENANT_B, name: 'Bravo Strategies' },
  { id: TENANT_A, name: 'Alpha Lobbying' },
  { id: TENANT_C, name: 'Charlie Fresh Onboard' },
];

const USAGE_ROWS = [
  {
    tenantId: TENANT_B,
    tenantName: 'Bravo Strategies',
    totalCostUsd: 99.5,
    totalTokens: 5_000_000,
    eventCount: 120,
    tenantKeyEventCount: 0,
  },
  {
    tenantId: TENANT_A,
    tenantName: 'Alpha Lobbying',
    totalCostUsd: 1.25,
    totalTokens: 80_000,
    eventCount: 9,
    tenantKeyEventCount: 9,
  },
];

const TENANT_B_USAGE = {
  from: '2026-05-12T00:00:00.000Z',
  to: '2026-06-11T00:00:00.000Z',
  eventCount: 120,
  totalCostUsd: 99.5,
  totalInputTokens: 4_000_000,
  totalOutputTokens: 1_000_000,
  tenantKeyEventCount: 0,
  byWorkflow: [],
  byModel: [],
  byDay: [],
};

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <App>
        <AiKeysAdminPanel />
      </App>
    </QueryClientProvider>,
  );
}

describe('AiKeysAdminPanel', () => {
  beforeAll(setupAntdBrowserMocks);

  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockImplementation(async (url: string) => {
      if (url === '/api/capiro-admin/tenants') return { data: TENANT_LIST };
      if (url === '/api/capiro-admin/ai-usage') return { data: USAGE_ROWS };
      if (url === `/api/capiro-admin/tenants/${TENANT_B}/ai-usage`) return { data: TENANT_B_USAGE };
      if (url === `/api/capiro-admin/tenants/${TENANT_B}/ai-credential`) return { data: [] };
      throw new Error(`unexpected GET ${url}`);
    });
  });

  test('lists every tenant with spend and the uses-own-key badge', async () => {
    renderPanel();

    expect(await screen.findByText('Bravo Strategies')).toBeInTheDocument();
    expect(screen.getByText('Alpha Lobbying')).toBeInTheDocument();
    expect(screen.getByText('$99.50')).toBeInTheDocument();
    expect(screen.getByText('$1.25')).toBeInTheDocument();
    // Alpha runs on its own key; the others run on the shared key.
    expect(screen.getByText('own key')).toBeInTheDocument();
    expect(screen.getAllByText('Capiro shared').length).toBeGreaterThanOrEqual(2);
  });

  test('a tenant with ZERO usage still appears with a Manage button (key can be set pre-usage)', async () => {
    renderPanel();

    expect(await screen.findByText('Charlie Fresh Onboard')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    const manageButtons = screen.getAllByRole('button', { name: /manage/i });
    expect(manageButtons).toHaveLength(TENANT_LIST.length);
  });

  test('saving a key for a tenant calls the ADMIN endpoint for that tenant', async () => {
    apiPostMock.mockResolvedValue({
      data: { provider: 'openai', last4: '4321', modelOverride: null, status: 'active' },
    });
    renderPanel();

    // Open the drawer for Bravo (first row by spend sort).
    const manageButtons = await screen.findAllByRole('button', { name: /manage/i });
    fireEvent.click(manageButtons[0]!);
    await screen.findByText(/Bravo Strategies — AI usage & key/);

    fireEvent.change(await screen.findByPlaceholderText('Paste API key (write-only)'), {
      target: { value: 'sk-proj-new-tenant-key-4321' },
    });
    fireEvent.click(screen.getByRole('button', { name: /validate & save/i }));

    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith(
        `/api/capiro-admin/tenants/${TENANT_B}/ai-credential`,
        expect.objectContaining({ provider: 'openai', apiKey: 'sk-proj-new-tenant-key-4321' }),
        expect.anything(),
      ),
    );
  });

  test('drawer never shows full key material for stored credentials', async () => {
    apiGetMock.mockImplementation(async (url: string) => {
      if (url === '/api/capiro-admin/tenants') return { data: TENANT_LIST };
      if (url === '/api/capiro-admin/ai-usage') return { data: USAGE_ROWS };
      if (url === `/api/capiro-admin/tenants/${TENANT_B}/ai-usage`) return { data: TENANT_B_USAGE };
      if (url === `/api/capiro-admin/tenants/${TENANT_B}/ai-credential`)
        return {
          data: [
            {
              provider: 'anthropic',
              last4: '7777',
              modelOverride: null,
              status: 'active',
              lastValidatedAt: null,
              updatedAt: null,
            },
          ],
        };
      throw new Error(`unexpected GET ${url}`);
    });
    renderPanel();

    const manageButtons = await screen.findAllByRole('button', { name: /manage/i });
    fireEvent.click(manageButtons[0]!);

    expect(await screen.findByText('•••• 7777')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('sk-');
  });
});
