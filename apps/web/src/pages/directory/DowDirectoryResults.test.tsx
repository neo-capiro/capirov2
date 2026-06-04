import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, test, vi, beforeAll } from 'vitest';
import { DowDirectoryResults } from './DowDirectoryResults.js';
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

describe('DowDirectoryResults', () => {
  beforeAll(setupAntdBrowserMocks);

  test('renders person cards with role tag and confidence pill', () => {
    render(
      <DowDirectoryResults
        persons={[person(), person({ id: 'p2', fullName: 'Bob Jones', confidence: 0.5, role: 'KO' })]}
        total={2}
        page={1}
        pageSize={12}
        onPage={vi.fn()}
        onSelectPerson={vi.fn()}
      />,
    );
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument(); // 0.97 -> high
    expect(screen.getByText('low')).toBeInTheDocument(); // 0.5 -> low
    expect(screen.getByText('PM')).toBeInTheDocument();
  });

  test('shows PE alignment tag when person has pePrimary, and unaligned tag otherwise', () => {
    render(
      <DowDirectoryResults
        persons={[
          person({ id: 'aligned', pePrimary: '0604201A' }),
          person({ id: 'unaligned', fullName: 'No Pe', pePrimary: null }),
        ]}
        total={2}
        page={1}
        pageSize={12}
        onPage={vi.fn()}
        onSelectPerson={vi.fn()}
      />,
    );
    expect(screen.getByText('PE 0604201A')).toBeInTheDocument();
    expect(screen.getByText('PE: unaligned')).toBeInTheDocument();
  });

  test('empty state', () => {
    render(
      <DowDirectoryResults
        persons={[]}
        total={0}
        page={1}
        pageSize={12}
        onPage={vi.fn()}
        onSelectPerson={vi.fn()}
      />,
    );
    expect(screen.getByText('No DoW directory personnel found')).toBeInTheDocument();
  });

  test('clicking a person card fires onSelectPerson with id', () => {
    const onSelect = vi.fn();
    render(
      <DowDirectoryResults
        persons={[person()]}
        total={1}
        page={1}
        pageSize={12}
        onPage={vi.fn()}
        onSelectPerson={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('Jane Smith'));
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  test('loading shows a spinner and no cards', () => {
    const { container } = render(
      <DowDirectoryResults
        persons={[]}
        loading
        total={0}
        page={1}
        pageSize={12}
        onPage={vi.fn()}
        onSelectPerson={vi.fn()}
      />,
    );
    expect(container.querySelector('.ant-spin')).not.toBeNull();
    expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
  });

  test('error state shows retry', () => {
    const onRetry = vi.fn();
    render(
      <DowDirectoryResults
        persons={[]}
        isError
        total={0}
        page={1}
        pageSize={12}
        onPage={vi.fn()}
        onSelectPerson={vi.fn()}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  test('pagination renders when total > pageSize and fires onPage', () => {
    const onPage = vi.fn();
    const { container } = render(
      <DowDirectoryResults
        persons={[person()]}
        total={50}
        page={1}
        pageSize={12}
        onPage={onPage}
        onSelectPerson={vi.fn()}
      />,
    );
    // Scope to the pagination control so numeric text in cards can't be matched.
    const pager = container.querySelector('.ant-pagination');
    expect(pager).not.toBeNull();
    const page2 = within(pager as HTMLElement).getByText('2');
    fireEvent.click(page2);
    // AntD Pagination.onChange fires (page, pageSize); assert the page arg.
    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage.mock.calls[0]?.[0]).toBe(2);
  });
});
