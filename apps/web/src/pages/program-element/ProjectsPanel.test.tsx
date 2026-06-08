import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ProjectsPanel, projectSourceHref } from './ProjectsPanel.js';
import type { ProgramElementProject } from './types.js';

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

function proj(over: Partial<ProgramElementProject> = {}): ProgramElementProject {
  return {
    id: 'p1',
    projectCode: 'AA1',
    title: 'Defense Research Sciences',
    mission: 'Fund basic research.',
    budgetActivity: '01',
    fy: 2027,
    sourceUrl: 'http://x/r2a.pdf',
    pageNumber: 42,
    confidence: 0.9,
    ...over,
  };
}

describe('ProjectsPanel', () => {
  beforeAll(setupAntdBrowserMocks);

  it('renders projects with a #page deep link', () => {
    render(<ProjectsPanel projects={[proj()]} />);
    expect(screen.getByText('AA1')).toBeInTheDocument();
    expect(screen.getByText('Defense Research Sciences')).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'http://x/r2a.pdf#page=42');
  });

  it('shows an honest empty state when there are no projects', () => {
    render(<ProjectsPanel projects={[]} />);
    expect(screen.getByText(/No R-2A projects extracted/)).toBeInTheDocument();
  });

  it('projectSourceHref appends #page only when a page is present', () => {
    expect(projectSourceHref({ sourceUrl: 'u', pageNumber: 5 })).toBe('u#page=5');
    expect(projectSourceHref({ sourceUrl: 'u', pageNumber: null })).toBe('u');
    expect(projectSourceHref({ sourceUrl: null, pageNumber: 5 })).toBeNull();
  });
});
