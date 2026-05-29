import { render, screen } from '@testing-library/react';
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
      <OfficeRecommenderList
        rows={rows}
        allCount={12}
        allHref="/intelligence/offices"
        rowHrefBuilder={(row) => `/intelligence/offices/${encodeURIComponent(row.name)}`}
      />,
    );

    expect(screen.getByRole('link', { name: /All 12/i })).toHaveAttribute('href', '/intelligence/offices');
    expect(screen.getByRole('link', { name: /Senate Armed Services Committee/i })).toHaveAttribute(
      'href',
      expect.stringContaining('/intelligence/offices/'),
    );
  });
});
