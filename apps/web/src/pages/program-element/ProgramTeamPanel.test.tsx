import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ProgramTeamPanel, confidencePillColor } from './ProgramTeamPanel.js';

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

const people = [
  { id: '1', fullName: 'COL Jane Doe', title: 'PEO Aviation', organization: 'PEO Aviation', role: 'PEO', confidence: 0.97, lastSeenAt: '2026-01-15T00:00:00.000Z', sourceCount: 4 },
  { id: '2', fullName: 'John Smith', title: 'Program Manager', organization: 'Army Futures Command', role: 'PM', confidence: 0.9, lastSeenAt: '2026-01-14T00:00:00.000Z', sourceCount: 2 },
  { id: '3', fullName: 'Alex Brown', title: 'DPM', organization: 'Navy', role: 'DPM', confidence: 0.79, lastSeenAt: '2026-01-13T00:00:00.000Z', sourceCount: 1 },
  { id: '4', fullName: 'Maria Lee', title: 'Contracting Officer', organization: 'AFLCMC', role: 'KO', confidence: 0.96, lastSeenAt: '2026-01-12T00:00:00.000Z', sourceCount: 3 },
  { id: '5', fullName: 'Sam Patel', title: 'Tech Director', organization: 'DARPA', role: 'TD', confidence: 0.81, lastSeenAt: '2026-01-11T00:00:00.000Z', sourceCount: 5 },
];

describe('ProgramTeamPanel', () => {
  test('renders with 5 persons and link actions', () => {
    setupBrowserMocks();
    const onLink = vi.fn();
    render(
      <ProgramTeamPanel
        personnel={people}
        estimatedTotal={12}
        onViewAllSources={() => undefined}
        onLinkCrmContact={onLink}
      />,
    );

    expect(screen.getByText('Program team')).toBeInTheDocument();
    expect(screen.getByText('5 of ~12 known')).toBeInTheDocument();
    expect(screen.getByText('View all sources →')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Link' })).toHaveLength(5);

    fireEvent.click(screen.getAllByRole('button', { name: 'Link' })[0]!);
    expect(onLink).toHaveBeenCalledWith('1');
  });

  test('shows empty state', () => {
    setupBrowserMocks();
    render(<ProgramTeamPanel personnel={[]} />);
    expect(screen.getByText('No team data found for this PE — log meeting contacts to build coverage')).toBeInTheDocument();
  });

  test('shows loading skeleton', () => {
    setupBrowserMocks();
    render(<ProgramTeamPanel personnel={[]} loading />);
    expect(screen.getByText('Program team')).toBeInTheDocument();
  });

  test('confidence pill colors follow threshold spec', () => {
    expect(confidencePillColor(0.95)).toBe('green');
    expect(confidencePillColor(0.9)).toBe('gold');
    expect(confidencePillColor(0.8)).toBe('gold');
    expect(confidencePillColor(0.79)).toBe('default');
  });
});
