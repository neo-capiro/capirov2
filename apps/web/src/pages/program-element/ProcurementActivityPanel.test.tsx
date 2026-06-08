import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  ProcurementActivityPanel,
  deadlineCountdown,
} from './ProcurementActivityPanel.js';
import type { OpportunityItem } from './types.js';

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

function opportunity(over: Partial<OpportunityItem> = {}): OpportunityItem {
  return {
    id: 'opp-1',
    noticeId: 'SAM-NOTICE-1',
    title: 'Long-Range Fires Components',
    noticeType: 'Solicitation',
    agency: 'Department of the Army',
    office: 'ACC-RSA',
    pscCode: '1410',
    naicsCode: '336414',
    postedDate: '2026-05-01T00:00:00.000Z',
    responseDeadline: '2026-07-01T00:00:00.000Z',
    sourceUrl: 'https://sam.gov/opp/abc',
    pocName: 'Jane Contracting',
    pocEmail: 'jane@army.mil',
    matchBasis: 'description_pe_code',
    reviewStatus: 'accepted',
    confidence: 0.99,
    ...over,
  };
}

describe('deadlineCountdown', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');

  test('null deadline -> "No deadline"', () => {
    expect(deadlineCountdown(null, now).label).toBe('No deadline');
  });

  test('past deadline -> "closed"', () => {
    expect(deadlineCountdown('2026-05-01T00:00:00.000Z', now).label).toBe('closed');
  });

  test('future deadline -> "closes in Nd"', () => {
    expect(deadlineCountdown('2026-06-13T00:00:00.000Z', now).label).toBe('closes in 12d');
  });

  test('today -> "closes today"', () => {
    expect(deadlineCountdown('2026-06-01T12:00:00.000Z', now).label).toBe('closes today');
  });
});

describe('ProcurementActivityPanel', () => {
  beforeAll(setupAntdBrowserMocks);
  afterEach(() => vi.useRealTimers());

  test('renders a notice with type, title link, agency·office, countdown, and POC guardrail', () => {
    // Freeze time so the countdown is deterministic (deadline is ~30d out).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));

    render(<ProcurementActivityPanel opportunities={[opportunity()]} />);

    expect(screen.getByText('Solicitation')).toBeInTheDocument();

    const link = screen.getByText('Long-Range Fires Components').closest('a');
    expect(link).toHaveAttribute('href', 'https://sam.gov/opp/abc');

    expect(screen.getByText('Department of the Army · ACC-RSA')).toBeInTheDocument();
    expect(screen.getByText('closes in 30d')).toBeInTheDocument();

    // POC guardrail: the badge AND the "not a lobbying target" note must both render.
    expect(screen.getByText('Official procurement POC')).toBeInTheDocument();
    expect(screen.getByText('Jane Contracting')).toBeInTheDocument();
    expect(
      screen.getByText(/official procurement contact — not a lobbying target/i),
    ).toBeInTheDocument();
  });

  test('shows the candidate review badge only for candidate rows', () => {
    render(
      <ProcurementActivityPanel
        opportunities={[
          opportunity({ id: 'a', reviewStatus: 'accepted' }),
          opportunity({
            id: 'b',
            noticeId: 'SAM-NOTICE-2',
            title: 'Sources Sought — Sensors',
            noticeType: 'Sources Sought',
            reviewStatus: 'candidate',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Sources Sought — Sensors')).toBeInTheDocument();
    expect(screen.getAllByText('Candidate — review')).toHaveLength(1);
  });

  test('shows an honest empty state for an empty array', () => {
    render(<ProcurementActivityPanel opportunities={[]} />);

    expect(
      screen.getByText(/No active procurement notices linked to this PE yet/),
    ).toBeInTheDocument();
  });

  test('does not crash on a null deadline / missing POC, and renders no POC badge', () => {
    render(
      <ProcurementActivityPanel
        opportunities={[
          opportunity({
            id: 'minimal',
            responseDeadline: null,
            pocName: null,
            pocEmail: null,
            sourceUrl: null,
          }),
        ]}
      />,
    );

    // Title still renders (as plain text, no link, since sourceUrl is null).
    expect(screen.getByText('Long-Range Fires Components')).toBeInTheDocument();
    // Null deadline -> the "No deadline" countdown tag.
    expect(screen.getByText('No deadline')).toBeInTheDocument();
    // No POC -> no guardrail badge.
    expect(screen.queryByText('Official procurement POC')).not.toBeInTheDocument();
  });

  test('guards against non-array / malformed data without throwing', () => {
    render(<ProcurementActivityPanel opportunities={undefined} />);

    expect(
      screen.getByText(/No active procurement notices linked to this PE yet/),
    ).toBeInTheDocument();
  });
});
