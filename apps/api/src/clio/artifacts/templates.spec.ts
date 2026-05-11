import { renderMeetingBrief } from './meeting-brief.template.js';
import { renderPolicyMemo } from './policy-memo.template.js';

describe('Clio artifact templates', () => {
  it('renders deterministic policy memo markdown', () => {
    expect(
      renderPolicyMemo({
        title: 'Defense Industrial Base Memo',
        issue: 'Congress is evaluating changes to acquisition rules.',
        background: 'The client needs a concise memo for Hill outreach.',
        stakeholders: [
          { name: 'House Armed Services Committee', position: 'Interested in procurement speed.' },
          { name: 'Client Government Affairs', position: 'Supports targeted modernization.' },
        ],
        recommendations: ['Prioritize two near-term asks.', 'Attach citations to every claim.'],
        citations: [
          { sourceTitle: 'Federal Register Notice', url: 'https://www.federalregister.gov/example' },
          { sourceTitle: 'Congress.gov Bill', url: 'https://www.congress.gov/bill/119th-congress/house-bill/1' },
        ],
      }),
    ).toBe(`# Defense Industrial Base Memo

## Issue
Congress is evaluating changes to acquisition rules.

## Background
The client needs a concise memo for Hill outreach. [^1] [^2]

## Stakeholders
- **House Armed Services Committee:** Interested in procurement speed.
- **Client Government Affairs:** Supports targeted modernization.

## Recommendations
- Prioritize two near-term asks.
- Attach citations to every claim.

## Citations
[^1]: Federal Register Notice — https://www.federalregister.gov/example
[^2]: Congress.gov Bill — https://www.congress.gov/bill/119th-congress/house-bill/1`);
  });

  it('renders deterministic meeting brief markdown', () => {
    expect(
      renderMeetingBrief({
        title: 'Senate Staff Meeting Brief',
        meetingDate: '2026-05-18T14:00:00Z',
        attendees: [
          { name: 'Avery Hill', org: 'Capiro' },
          { name: 'Jordan Lee' },
        ],
        talkingPoints: ['Open with implementation timeline.', 'Connect the ask to district jobs.'],
        asks: ['Request feedback on draft language.', 'Confirm follow-up owner.'],
        context: 'The meeting follows prior outreach on appropriations language.',
      }),
    ).toBe(`# Senate Staff Meeting Brief

## Meeting Details
- Date: 2026-05-18T14:00:00Z

## Attendees
- Avery Hill, Capiro
- Jordan Lee

## Context
The meeting follows prior outreach on appropriations language.

## Talking Points
- Open with implementation timeline.
- Connect the ask to district jobs.

## Asks
- Request feedback on draft language.
- Confirm follow-up owner.`);
  });
});
