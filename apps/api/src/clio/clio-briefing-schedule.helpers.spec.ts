import { describe, expect, test } from '@jest/globals';
import {
  formatBriefingDigest,
  selectMeetingBriefings,
  type UpcomingMeeting,
} from './clio-briefing-schedule.helpers.js';

const now = new Date('2026-06-01T09:00:00Z');
const at = (iso: string): Date => new Date(iso);

function mtg(over: Partial<UpcomingMeeting>): UpcomingMeeting {
  return {
    id: over.id ?? 'm1',
    userId: over.userId ?? 'u1',
    clientId: over.clientId ?? 'c1',
    clientName: over.clientName ?? 'Acme',
    title: over.title ?? 'Hill meeting',
    startsAt: over.startsAt ?? at('2026-06-03T15:00:00Z'),
  };
}

describe('selectMeetingBriefings', () => {
  test('first run: briefs all meetings within the lookahead window', () => {
    const plans = selectMeetingBriefings(
      [
        mtg({ id: 'a', startsAt: at('2026-06-03T15:00:00Z') }), // in window
        mtg({ id: 'b', startsAt: at('2026-06-20T15:00:00Z') }), // beyond 7d
        mtg({ id: 'c', startsAt: at('2026-05-30T15:00:00Z') }), // past
      ],
      { now, lookaheadDays: 7, lastRunAt: null },
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]!.meetings.map((m) => m.id)).toEqual(['a']);
  });

  test('only briefs meetings that newly entered the window since last run', () => {
    // lastRun yesterday: its window covered up to 2026-06-07. A meeting on 06-05
    // was already in that window (skip); one on 06-08 newly enters now.
    const plans = selectMeetingBriefings(
      [
        mtg({ id: 'old', startsAt: at('2026-06-05T15:00:00Z') }),
        mtg({ id: 'new', startsAt: at('2026-06-08T08:00:00Z') }),
      ],
      { now, lookaheadDays: 7, lastRunAt: at('2026-05-31T09:00:00Z') },
    );
    expect(plans[0]!.meetings.map((m) => m.id)).toEqual(['new']);
  });

  test('groups by user and sorts each by soonest', () => {
    const plans = selectMeetingBriefings(
      [
        mtg({ id: 'u1b', userId: 'u1', startsAt: at('2026-06-04T15:00:00Z') }),
        mtg({ id: 'u1a', userId: 'u1', startsAt: at('2026-06-02T15:00:00Z') }),
        mtg({ id: 'u2a', userId: 'u2', startsAt: at('2026-06-03T15:00:00Z') }),
      ],
      { now, lookaheadDays: 7, lastRunAt: null },
    );
    expect(plans).toHaveLength(2);
    const u1 = plans.find((p) => p.userId === 'u1')!;
    expect(u1.meetings.map((m) => m.id)).toEqual(['u1a', 'u1b']);
  });
});

describe('formatBriefingDigest', () => {
  test('renders a bulleted digest with client names', () => {
    const digest = formatBriefingDigest({
      userId: 'u1',
      meetings: [mtg({ title: 'Prep call', clientName: 'Globex' })],
    });
    expect(digest).toContain('Upcoming meetings');
    expect(digest).toContain('Prep call');
    expect(digest).toContain('Globex');
  });
});
