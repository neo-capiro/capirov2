import { markdownHeading, markdownList, normalizeBlock, normalizeInline } from './markdown.js';

export interface MeetingBriefInput {
  title: string;
  meetingDate: string;
  attendees: { name: string; org?: string }[];
  talkingPoints: string[];
  asks: string[];
  context: string;
}

export function renderMeetingBrief(input: MeetingBriefInput): string {
  return [
    markdownHeading(1, input.title),
    '',
    markdownHeading(2, 'Meeting Details'),
    `- Date: ${normalizeInline(input.meetingDate)}`,
    '',
    markdownHeading(2, 'Attendees'),
    ...renderAttendees(input.attendees),
    '',
    markdownHeading(2, 'Context'),
    normalizeBlock(input.context),
    '',
    markdownHeading(2, 'Talking Points'),
    ...renderList(input.talkingPoints, 'No talking points provided.'),
    '',
    markdownHeading(2, 'Asks'),
    ...renderList(input.asks, 'No asks provided.'),
  ].join('\n');
}

function renderAttendees(attendees: MeetingBriefInput['attendees']): string[] {
  if (attendees.length === 0) return ['- No attendees provided.'];
  return attendees.map((attendee) => {
    const org = attendee.org ? `, ${normalizeInline(attendee.org)}` : '';
    return `- ${normalizeInline(attendee.name)}${org}`;
  });
}

function renderList(items: string[], emptyText: string): string[] {
  return items.length > 0 ? markdownList(items) : [`- ${emptyText}`];
}

