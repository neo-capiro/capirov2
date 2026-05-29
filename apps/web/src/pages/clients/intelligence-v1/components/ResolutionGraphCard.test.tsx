import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ResolutionGraphCard } from './ResolutionGraphCard.js';

describe('ResolutionGraphCard controls', () => {
  test('expand toggles to collapse and reset clears focus/expanded state', () => {
    render(
      <ResolutionGraphCard
        scopedGraph={{
          resolutionQuality: { avgConfidence: 72, confirmedCount: 5, unconfirmedCount: 1 },
          meta: { lobbyistCount: 8, memberCount: 15, committeeCount: 9 },
        }}
      />,
    );

    const expandBtn = screen.getByRole('button', { name: /Expand/i });
    fireEvent.click(expandBtn);
    expect(screen.getByRole('button', { name: /Collapse/i })).toBeInTheDocument();

    // Focus a node then reset
    const memberNodes = screen.getAllByRole('button', { name: /Member\s*Member 1/i });
    const memberNode = memberNodes[0];
    expect(memberNode).toBeDefined();
    if (!memberNode) throw new Error('expected at least one member node');
    fireEvent.click(memberNode);

    fireEvent.click(screen.getByRole('button', { name: /^Reset$/i }));
    expect(screen.getByRole('button', { name: /Expand/i })).toBeInTheDocument();
  });
});
