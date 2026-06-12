import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { AiUsagePage, apiErrorMessage } from './AiUsagePage.js';

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

const SUMMARY = {
  from: '2026-05-12T00:00:00.000Z',
  to: '2026-06-11T00:00:00.000Z',
  eventCount: 42,
  totalCostUsd: 12.3456,
  totalInputTokens: 900_000,
  totalOutputTokens: 100_000,
  tenantKeyEventCount: 5,
  byWorkflow: [
    { workflow: 'outreach_campaign', costUsd: 10.0, inputTokens: 800_000, outputTokens: 80_000, count: 30 },
    { workflow: 'meeting_prep', costUsd: 2.3456, inputTokens: 100_000, outputTokens: 20_000, count: 12 },
  ],
  byModel: [
    { model: 'gpt-4.1-mini', costUsd: 12.3456, inputTokens: 900_000, outputTokens: 100_000, count: 42 },
  ],
  byDay: [
    { day: '2026-06-09', costUsd: 4.0, inputTokens: 1, outputTokens: 1, count: 10 },
    { day: '2026-06-10', costUsd: 8.3456, inputTokens: 1, outputTokens: 1, count: 32 },
  ],
};

const CREDENTIALS = [
  {
    provider: 'openai',
    last4: '9876',
    modelOverride: 'gpt-4.1',
    status: 'active',
    lastValidatedAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
  },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <App>
        <AiUsagePage />
      </App>
    </QueryClientProvider>,
  );
}

describe('AiUsagePage', () => {
  beforeAll(setupAntdBrowserMocks);

  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockImplementation(async (url: string) => {
      if (url === '/api/ai-usage/summary') return { data: SUMMARY };
      if (url === '/api/ai-usage/credential') return { data: CREDENTIALS };
      throw new Error(`unexpected GET ${url}`);
    });
  });

  test('renders spend cards, breakdowns, and the masked key — never the full key', async () => {
    renderPage();

    // antd Statistic splits the value into int/decimal spans — assert on the
    // whole statistic block instead of one text node.
    const spendLabel = await screen.findByText('Estimated spend');
    expect(spendLabel.closest('.ant-statistic')?.textContent).toContain('$12.35');
    expect(screen.getByText('Generations')).toBeInTheDocument();
    // 'Tokens' also appears as a table header — pick the Statistic instance.
    const tokensStat = screen
      .getAllByText('Tokens')
      .map((el) => el.closest('.ant-statistic'))
      .find(Boolean);
    expect(tokensStat?.textContent).toContain('1,000,000');
    expect(screen.getByText('5 billed to your own key')).toBeInTheDocument();

    // Breakdown rows.
    expect(screen.getByText('outreach_campaign')).toBeInTheDocument();
    expect(screen.getByText('gpt-4.1-mini')).toBeInTheDocument();

    // The saved key shows masked last-4 only.
    expect(await screen.findByText('•••• 9876')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('sk-');
  });

  test('saving a bad key surfaces the provider validation error and keeps nothing', async () => {
    apiPostMock.mockRejectedValue({
      response: { data: { message: 'API key validation failed: Incorrect API key provided' } },
    });
    renderPage();
    await screen.findByText('•••• 9876');

    fireEvent.change(screen.getByPlaceholderText('Paste API key (write-only)'), {
      target: { value: 'sk-bad-key-000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /validate & save/i }));

    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith(
        '/api/ai-usage/credential',
        expect.objectContaining({ provider: 'openai', apiKey: 'sk-bad-key-000000' }),
        expect.anything(),
      ),
    );
    expect(
      await screen.findByText(/API key validation failed: Incorrect API key provided/),
    ).toBeInTheDocument();
  });

  test('removing a key calls the delete endpoint for that provider', async () => {
    apiDeleteMock.mockResolvedValue({ data: { removed: true } });
    renderPage();
    await screen.findByText('•••• 9876');

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    // antd Popconfirm renders OK/Cancel; confirm.
    fireEvent.click(await screen.findByRole('button', { name: /ok/i }));

    await waitFor(() =>
      expect(apiDeleteMock).toHaveBeenCalledWith('/api/ai-usage/credential/openai'),
    );
  });
});

describe('apiErrorMessage', () => {
  test('prefers the API message, joins arrays, falls back to Error.message', () => {
    expect(apiErrorMessage({ response: { data: { message: 'boom' } } })).toBe('boom');
    expect(apiErrorMessage({ response: { data: { message: ['a', 'b'] } } })).toBe('a; b');
    expect(apiErrorMessage(new Error('net down'))).toBe('net down');
  });
});
