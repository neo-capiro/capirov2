import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { TopAlertsList } from './TopAlertsList.js';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));

describe('TopAlertsList CTAs and row controls', () => {
  beforeEach(() => navigateMock.mockReset());

  test('View all CTA navigates to links.viewAllHref', () => {
    render(
      <TopAlertsList
        aggregate={undefined}
        fallbackAlerts={[]}
        loading={false}
        links={{ viewAllHref: '/intelligence/changes?clientId=abc', mappingsHref: '/settings/intelligence-mappings' }}
      />, 
    );

    fireEvent.click(screen.getByRole('button', { name: /View all/i }));
    expect(navigateMock).toHaveBeenCalledWith('/intelligence/changes?clientId=abc');
  });

  test('source mappings CTA navigates to mappings route', () => {
    render(
      <TopAlertsList
        aggregate={undefined}
        fallbackAlerts={[]}
        loading={false}
        links={{ viewAllHref: '/intelligence/changes?clientId=abc', mappingsHref: '/settings/intelligence-mappings' }}
      />, 
    );

    fireEvent.click(screen.getByRole('button', { name: /source mappings/i }));
    expect(navigateMock).toHaveBeenCalledWith('/settings/intelligence-mappings');
  });

  test('clicking an alert row drills with client filter preserved', () => {
    const aggregate: any = {
      sections: {
        snapshot: {
          topAlerts: [
            {
              id: 'a1',
              type: 'regulatory',
              severity: 'critical',
              title: 'EPA deadline',
              subtitle: 'Federal Register',
              when: new Date().toISOString(),
              href: '/intelligence/changes?type=reg',
            },
          ],
        },
      },
    };

    render(
      <TopAlertsList
        aggregate={aggregate}
        fallbackAlerts={[]}
        loading={false}
        links={{ viewAllHref: '/intelligence/changes?clientId=abc', mappingsHref: '/settings/intelligence-mappings' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /EPA deadline/i }));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('clientId=abc'));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('type=reg'));
  });
});
