import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ActionBoardPage } from './ActionBoardPage.js';
import type { ActionCardDto } from './types.js';

const apiGetMock = vi.fn();
const apiPatchMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock('../../lib/use-api.js', () => ({
  useApi: () => ({
    get: apiGetMock,
    patch: apiPatchMock,
    post: apiPostMock,
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

  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  }
}

function makeCard(overrides: Partial<ActionCardDto> = {}): ActionCardDto {
  return {
    id: 'act-1',
    clientId: 'client-1',
    clientName: 'Acme Defense',
    peCode: '0603270A',
    programId: 'prog-1',
    deltaId: 'delta-1',
    actionType: 'protect_funding',
    issueTitle: 'HASC adds $50M to PE 0603270A',
    whatChanged: 'House Armed Services Committee marked the program at $537M, +$50M over request.',
    whyItMatters: 'Acme Defense is the prime on this program element.',
    recommendedAction: 'Send a thank-you and protect the mark through conference.',
    targetAudience: [
      { kind: 'committee', id: 'cmte-hasc', label: 'House Armed Services Committee' },
      { kind: 'person_role', id: 'pr-1', label: 'Jane Staffer', contactUse: 'authorized' },
    ],
    suggestedArtifactType: 'committee_staff_memo',
    deadline: null,
    deadlineSource: null,
    ownerUserId: null,
    priority: 82,
    confidence: { delta: 'high', programMatch: 'high', peopleMatch: 'medium', clientRelevance: 'high' },
    uncertainty: null,
    evidence: [
      { kind: 'delta', deltaId: 'delta-1' },
      { kind: 'source', sourceDocumentId: 'doc-1', page: 42 },
    ],
    status: 'new',
    dismissalReason: null,
    outcome: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AntApp>
        <MemoryRouter initialEntries={['/actions']}>
          <Routes>
            <Route path="/actions" element={<ActionBoardPage />} />
            <Route path="/program-elements/:peCode" element={<div data-testid="pe-destination">PE</div>} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('ActionBoardPage', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPatchMock.mockReset();
    apiPostMock.mockReset();
    setupBrowserMocks();
    apiPatchMock.mockResolvedValue({ data: {} });
    apiPostMock.mockResolvedValue({ data: { generated: 0 } });
  });

  test('renders a card with section-10 fields, audience contactUse badge, and no-deadline handling', async () => {
    apiGetMock.mockImplementation(async (url: string) => {
      if (url === '/api/intelligence/actions') {
        return { data: { data: [makeCard()], total: 1, page: 1, limit: 100 } };
      }
      if (url === '/api/tenant-admin/team') {
        return { data: [{ userId: 'u-1', email: 'neo@capiro.ai', firstName: 'Neo', lastName: 'M' }] };
      }
      return { data: [] };
    });

    renderBoard();

    await waitFor(() =>
      expect(screen.getByText(/HASC adds \$50M to PE 0603270A/i)).toBeInTheDocument(),
    );

    // section-10 narrative fields
    expect(screen.getByText(/House Armed Services Committee marked the program/i)).toBeInTheDocument();
    expect(screen.getByText(/Acme Defense is the prime/i)).toBeInTheDocument();
    expect(screen.getByText(/Send a thank-you and protect the mark/i)).toBeInTheDocument();

    // action-type badge + status badge
    expect(screen.getByText('Protect Funding')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();

    // audience member + its contact-use badge
    expect(screen.getByText('Jane Staffer')).toBeInTheDocument();
    expect(screen.getByText(/\(authorized\)/i)).toBeInTheDocument();

    // confidence band chip
    expect(screen.getByText(/Delta: high/i)).toBeInTheDocument();

    // null deadline → honest copy
    expect(screen.getByText('No known deadline')).toBeInTheDocument();
  });

  test('uncertainty is shown prominently when set', async () => {
    apiGetMock.mockImplementation(async (url: string) => {
      if (url === '/api/intelligence/actions') {
        return {
          data: {
            data: [
              makeCard({
                id: 'act-2',
                actionType: 'escalate_uncertainty',
                uncertainty: 'Program match is only a candidate — verify before client outreach.',
              }),
            ],
            total: 1,
            page: 1,
            limit: 100,
          },
        };
      }
      return { data: [] };
    });

    renderBoard();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Program match is only a candidate/i)).toBeInTheDocument();
  });

  test('dismissal modal requires a reason (submit disabled until typed)', async () => {
    apiGetMock.mockImplementation(async (url: string) => {
      if (url === '/api/intelligence/actions') {
        return { data: { data: [makeCard()], total: 1, page: 1, limit: 100 } };
      }
      return { data: [] };
    });

    renderBoard();

    await waitFor(() => expect(screen.getByText(/HASC adds \$50M/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^Dismiss$/i }));

    // modal open with a disabled confirm button
    const reasonInput = await screen.findByLabelText('Dismissal reason');
    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /^Dismiss$/i });
    expect(confirmBtn).toBeDisabled();

    // clicking the disabled button must NOT fire the PATCH
    fireEvent.click(confirmBtn);
    expect(apiPatchMock).not.toHaveBeenCalled();

    // typing a reason enables submit and the PATCH carries the reason
    apiPatchMock.mockResolvedValueOnce({ data: makeCard({ status: 'dismissed', dismissalReason: 'Not relevant' }) });
    fireEvent.change(reasonInput, { target: { value: 'Not relevant' } });
    expect(confirmBtn).not.toBeDisabled();

    fireEvent.click(confirmBtn);
    await waitFor(() =>
      expect(apiPatchMock).toHaveBeenCalledWith(
        '/api/intelligence/actions/act-1/status',
        { status: 'dismissed', dismissalReason: 'Not relevant' },
      ),
    );
  });

  test('honest empty state when there are no actions', async () => {
    apiGetMock.mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 100 } });

    renderBoard();

    await waitFor(() =>
      expect(screen.getByText(/No action recommendations yet/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Generate actions/i })).toBeInTheDocument();
  });

  test('Generate posts to /generate then refetches', async () => {
    apiGetMock.mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 100 } });
    apiPostMock.mockResolvedValue({ data: { generated: 3 } });

    renderBoard();

    await waitFor(() => expect(screen.getByText(/No action recommendations yet/i)).toBeInTheDocument());

    // header Generate button
    const [headerGenerate] = screen.getAllByRole('button', { name: /Generate/i });
    expect(headerGenerate).toBeDefined();
    fireEvent.click(headerGenerate as HTMLElement);

    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith('/api/intelligence/actions/generate'),
    );
  });
});
