import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { CoveragePanel } from './CoveragePanel.js';
import type { CoverageEntry, CoverageResult } from './coverage-api.js';
import type { TeamMemberOption } from './actions-api.js';

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock('../../lib/use-api.js', () => ({
  useApi: () => ({
    get: apiGetMock,
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

const TEAM: TeamMemberOption[] = [
  { userId: 'u-1', email: 'neo@capiro.ai', firstName: 'Neo', lastName: 'M' },
];

function entry(overrides: Partial<CoverageEntry> = {}): CoverageEntry {
  return {
    officeId: 'office-1',
    officeName: 'Rep. Smith (CA-12)',
    personId: 'p-1',
    personName: 'Jane Staffer',
    roleTitle: 'Legislative Director',
    contactUse: 'lobbying_contact',
    contactUseLabel: 'Lobbying contact',
    lastTouch: '2026-05-01T00:00:00.000Z',
    owner: 'Neo M',
    strength: 'active',
    outreachEligible: true,
    ...overrides,
  };
}

function renderPanel(result: CoverageResult) {
  apiGetMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/coverage')) return { data: result };
    return { data: [] };
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AntApp>
        <CoveragePanel actionId="act-1" teamMembers={TEAM} enabled />
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('CoveragePanel', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    setupBrowserMocks();
    apiPostMock.mockResolvedValue({ data: { id: 'new-act', created: true, status: 'new' } });
  });

  test('renders a gap row with its Assign & create outreach control', async () => {
    const result: CoverageResult = {
      peCode: '0603270A',
      clientId: 'client-1',
      strong: [entry()],
      weak: [],
      none: [
        entry({
          officeId: 'office-gap',
          officeName: 'Rep. Gap (TX-03)',
          personId: undefined,
          personName: undefined,
          roleTitle: undefined,
          lastTouch: null,
          owner: null,
          strength: 'none',
          outreachEligible: true,
          contactUse: 'lobbying_contact',
          contactUseLabel: 'Lobbying contact',
        }),
      ],
      whyNow: { whatChanged: 'HASC marked the program +$50M', deadline: null },
    };

    renderPanel(result);

    // whyNow line atop the section
    await waitFor(() => expect(screen.getByText(/Why now:/i)).toBeInTheDocument());
    expect(screen.getByText(/HASC marked the program/i)).toBeInTheDocument();

    // strong band row present
    expect(screen.getByText('Rep. Smith (CA-12)')).toBeInTheDocument();

    // the gap (none) row + its actionable control
    expect(screen.getByText('Rep. Gap (TX-03)')).toBeInTheDocument();
    const assignBtn = screen.getByRole('button', { name: /Assign & create outreach/i });
    expect(assignBtn).toBeInTheDocument();
    // disabled until an owner is picked
    expect(assignBtn).toBeDisabled();
  });

  test('an outreachEligible:false row shows the badge but NO outreach button', async () => {
    const result: CoverageResult = {
      peCode: '0603270A',
      strong: [],
      weak: [],
      none: [
        entry({
          officeId: 'office-ctx',
          officeName: 'DoD Program Office',
          personId: 'p-ctx',
          personName: 'Col. Context',
          roleTitle: 'Program Manager',
          contactUse: 'do_not_contact_procurement_sensitive',
          contactUseLabel: 'Do not contact (procurement-sensitive)',
          strength: 'none',
          outreachEligible: false,
        }),
      ],
    };

    renderPanel(result);

    // the contactUse badge renders for the context row
    await waitFor(() =>
      expect(screen.getByText(/Do not contact \(procurement-sensitive\)/i)).toBeInTheDocument(),
    );
    expect(screen.getByText('DoD Program Office')).toBeInTheDocument();
    // the explicit "context" hint (exact match — the badge label also contains "contact")
    expect(screen.getByText('context')).toBeInTheDocument();

    // NO outreach control for a context-only row
    expect(
      screen.queryByRole('button', { name: /Assign & create outreach/i }),
    ).not.toBeInTheDocument();
  });

  test('posts outreach (office-only gap omits personId) on assign', async () => {
    const result: CoverageResult = {
      peCode: '0603270A',
      strong: [],
      weak: [],
      none: [
        entry({
          officeId: 'office-gap',
          officeName: 'Rep. Gap (TX-03)',
          personId: undefined,
          personName: undefined,
          roleTitle: undefined,
          lastTouch: null,
          owner: null,
          strength: 'none',
          outreachEligible: true,
        }),
      ],
    };

    renderPanel(result);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Assign & create outreach/i })).toBeInTheDocument(),
    );

    // pick an owner via the Select
    const combobox = screen.getByRole('combobox');
    fireEvent.mouseDown(combobox);
    const option = await screen.findByText('Neo M');
    fireEvent.click(option);

    const assignBtn = screen.getByRole('button', { name: /Assign & create outreach/i });
    await waitFor(() => expect(assignBtn).not.toBeDisabled());
    fireEvent.click(assignBtn);

    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith('/api/intelligence/coverage/outreach', {
        actionId: 'act-1',
        officeId: 'office-gap',
        ownerUserId: 'u-1',
      }),
    );
    // office-only row: personId MUST be absent from the body
    const postBody = apiPostMock.mock.calls[0]?.[1];
    expect(postBody).not.toHaveProperty('personId');
  });

  test('honest empty state when there is no coverage data', async () => {
    const result: CoverageResult = { peCode: '0603270A', strong: [], weak: [], none: [] };
    renderPanel(result);
    await waitFor(() =>
      expect(screen.getByText(/No relationship-coverage data for this PE yet/i)).toBeInTheDocument(),
    );
  });

  test('does not crash on a malformed payload (missing bands)', async () => {
    // strong/none arrays missing entirely — Array.isArray guards must hold.
    renderPanel({ peCode: '0603270A' } as unknown as CoverageResult);
    await waitFor(() => {
      const panel = screen.getByTestId('coverage-panel');
      expect(within(panel).getByText(/No relationship-coverage data for this PE yet/i)).toBeInTheDocument();
    });
  });
});
