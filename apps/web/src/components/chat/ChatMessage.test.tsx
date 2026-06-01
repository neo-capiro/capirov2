import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ChatMessage } from './ChatMessage.js';
import type { ClioCitation } from './chat-store.js';

const citations: ClioCitation[] = [
  {
    n: 1,
    type: 'bill',
    id: 'hr1',
    title: 'Defense Authorization Act',
    url: null,
    snippet: null,
    tool: 'search_congress_bills',
  },
  {
    n: 2,
    type: 'lda_filing',
    id: 'x',
    title: 'Budget Resolution',
    url: 'https://congress.gov/budget',
    snippet: 'A budget resolution summary.',
    tool: 'search_lda_filings',
  },
];

describe('ChatMessage citations', () => {
  test('renders matched [N] markers as clickable chips and leaves unmatched markers as text', () => {
    render(
      <ChatMessage
        role="assistant"
        content="The Defense Act [1] advanced; see the budget [2]. Unknown [3]."
        citations={citations}
      />,
    );
    expect(screen.getByRole('button', { name: '[1]' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '[2]' })).toBeTruthy();
    // [3] has no matching citation, so it must NOT become a button.
    expect(screen.queryByRole('button', { name: '[3]' })).toBeNull();
  });

  test('clicking a citation chip opens a drawer with the matched source', () => {
    render(<ChatMessage role="assistant" content="See the budget [2]." citations={citations} />);
    // Drawer content is not present until the chip is clicked.
    expect(screen.queryByText('Budget Resolution')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '[2]' }));
    expect(screen.getByText('Budget Resolution')).toBeTruthy();
    expect(screen.getByText('A budget resolution summary.')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Open source/i });
    expect(link.getAttribute('href')).toBe('https://congress.gov/budget');
  });

  test('user messages render as plain text without citation chips', () => {
    render(<ChatMessage role="user" content="What about bill [1]?" citations={citations} />);
    expect(screen.queryByRole('button', { name: '[1]' })).toBeNull();
    expect(screen.getByText('What about bill [1]?')).toBeTruthy();
  });
});
