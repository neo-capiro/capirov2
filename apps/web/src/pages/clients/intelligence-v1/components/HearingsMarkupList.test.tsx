import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { HearingsMarkupList } from './HearingsMarkupList.js';

describe('HearingsMarkupList controls', () => {
  const items = [
    {
      id: 'h-1',
      month: 'Jun',
      day: '03',
      title: 'SENR markup',
      sub: 'Critical minerals',
      time: '10:00 AM',
      room: 'SR-366',
    },
    {
      id: 'h-2',
      month: 'Jun',
      day: '11',
      title: 'HASC full committee',
      sub: 'NDAA',
      time: '9:00 AM',
      room: '2118 RHOB',
    },
  ];

  test('selecting a hearing updates Sync to calendar CTA context', () => {
    render(
      <HearingsMarkupList
        items={items}
        syncCalendarHref="/engagement"
        setAlertsHref="/intelligence/changes"
      />, 
    );

    // default first item selected
    expect(screen.getByRole('link', { name: /Sync to calendar/i })).toHaveAttribute(
      'href',
      expect.stringContaining('hearing=h-1'),
    );

    fireEvent.click(screen.getByText('HASC full committee'));

    expect(screen.getByRole('link', { name: /Sync to calendar/i })).toHaveAttribute(
      'href',
      expect.stringContaining('hearing=h-2'),
    );
  });

  test('Set alerts CTA includes selected hearing context', () => {
    render(
      <HearingsMarkupList
        items={items}
        syncCalendarHref="/engagement"
        setAlertsHref="/intelligence/changes?clientId=abc"
      />, 
    );

    fireEvent.click(screen.getByText('HASC full committee'));

    expect(screen.getByRole('link', { name: /Set alerts/i })).toHaveAttribute(
      'href',
      expect.stringContaining('hearing=h-2'),
    );
    expect(screen.getByRole('link', { name: /Set alerts/i }).getAttribute('href')).toContain('clientId=abc');
  });
});
