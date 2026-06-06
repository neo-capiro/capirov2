import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import { OfficeRecommenderList } from './OfficeRecommenderList.js';

describe('OfficeRecommenderList links', () => {
  const rows = [
    {
      rank: 1,
      name: 'Senate Armed Services Committee',
      sub: 'Jurisdiction overlap',
      tags: [{ label: 'committee', variant: 'amber' as const }],
      score: 0.92,
    },
  ];

  test('renders All N anchor and row drill links when link builders provided', () => {
    render(
      <MemoryRouter>
        <OfficeRecommenderList
          rows={rows}
          allCount={12}
          allHref="/intelligence/offices"
          rowHrefBuilder={(row) => `/intelligence/offices/${encodeURIComponent(row.name)}`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /All 12/i })).toHaveAttribute('href', '/intelligence/offices');
    expect(screen.getByRole('link', { name: /Senate Armed Services Committee/i })).toHaveAttribute(
      'href',
      expect.stringContaining('/intelligence/offices/'),
    );
  });

  test('header link is independent of row links: shows allLabel link, rows are informational', () => {
    render(
      <MemoryRouter>
        <OfficeRecommenderList
          rows={rows}
          allCount={1}
          allHref="/intelligence/issues/DEF"
          allLabel="Issue landscape"
        />
      </MemoryRouter>,
    );

    // Header link uses the custom label + provided href...
    expect(screen.getByRole('link', { name: /Issue landscape/i })).toHaveAttribute(
      'href',
      '/intelligence/issues/DEF',
    );
    // ...but with no rowHrefBuilder the office row is informational, not a link.
    expect(screen.queryByRole('link', { name: /Senate Armed Services Committee/i })).toBeNull();
  });
});
