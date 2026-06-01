import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ChatMessage } from './ChatMessage.js';
import type { ClioCitation, ClioVerification } from './chat-store.js';

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

const lowConfidenceVerification: ClioVerification = {
  claims: [
    { claim: 'HR1 cleared committee', supported: true, sourceIds: [1] },
    { claim: 'HR1 will pass the floor next week', supported: false, sourceIds: [] },
    { claim: 'The sponsor is retiring', supported: false, sourceIds: [] },
  ],
  totalCount: 3,
  unsupportedCount: 2,
  unsupportedRatio: 2 / 3,
  lowConfidence: true,
};

describe('ChatMessage verification gate', () => {
  test('shows a low-confidence banner and lists the unsupported claims', () => {
    render(
      <ChatMessage
        role="assistant"
        content="Here is the briefing."
        verification={lowConfidenceVerification}
      />,
    );
    expect(screen.getByText(/Low confidence/i)).toBeTruthy();
    expect(screen.getByText('HR1 will pass the floor next week')).toBeTruthy();
    expect(screen.getByText('The sponsor is retiring')).toBeTruthy();
    // supported claims are not listed as flagged
    expect(screen.queryByText('HR1 cleared committee')).toBeNull();
  });

  test('shows a grounded confirmation when all claims are supported', () => {
    const allSupported: ClioVerification = {
      claims: [{ claim: 'x', supported: true, sourceIds: [1] }],
      totalCount: 1,
      unsupportedCount: 0,
      unsupportedRatio: 0,
      lowConfidence: false,
    };
    render(<ChatMessage role="assistant" content="ok" verification={allSupported} />);
    expect(screen.getByText(/checked against sources/i)).toBeTruthy();
    expect(screen.queryByText(/Low confidence/i)).toBeNull();
  });

  test('renders nothing extra when there is no verification', () => {
    render(<ChatMessage role="assistant" content="plain answer" />);
    expect(screen.queryByText(/Low confidence/i)).toBeNull();
    expect(screen.queryByText(/checked against sources/i)).toBeNull();
  });
});
