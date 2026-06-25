import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { SectionNav } from './SectionNav.js';
import type { SectionMeta } from '../mappers.js';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

describe('SectionNav interactions', () => {
  const sections: SectionMeta[] = [
    { id: 'snapshot', num: 1, title: 'Snapshot', shortTitle: 'Snapshot' },
    { id: 'financial-footprint', num: 2, title: 'Financial Footprint', shortTitle: 'Financial' },
    { id: 'legislative-regulatory', num: 3, title: 'Legislative & Regulatory', shortTitle: 'Legislative' },
  ];

  test('fires nav callback when section button clicked', () => {
    const onNavClick = vi.fn();
    render(
      <SectionNav
        sections={sections}
        activeSection="snapshot"
        onNavClick={onNavClick}
        syncedAt={new Date().toISOString()}
        sourceCount={3}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Legislative/i }));
    expect(onNavClick).toHaveBeenCalledWith('legislative-regulatory');
  });

  test('manage sources CTA navigates to mappings settings', () => {
    const onNavClick = vi.fn();
    render(
      <SectionNav
        sections={sections}
        activeSection="snapshot"
        onNavClick={onNavClick}
        syncedAt={new Date().toISOString()}
        sourceCount={2}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Manage sources/i }));
    expect(navigateMock).toHaveBeenCalledWith('/settings/intelligence-mappings');
  });
});
