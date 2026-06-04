import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { TopAlertsList } from './TopAlertsList.js';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));

// useApi returns an axios-like client; the worklist/brief mutations call .post.
const postMock = vi.fn(async () => ({ data: {} }));
vi.mock('../../../../lib/use-api.js', () => ({
  useApi: () => ({ post: postMock, get: vi.fn(), delete: vi.fn() }),
}));

function renderList(props: Partial<Parameters<typeof TopAlertsList>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <TopAlertsList
          aggregate={undefined}
          fallbackAlerts={[]}
          loading={false}
          clientId="abc"
          links={{ viewAllHref: '/intelligence/changes?clientId=abc', mappingsHref: '/settings/intelligence-mappings' }}
          {...props}
        />
      </AntApp>
    </QueryClientProvider>,
  );
}

const mkAlert = (over: Record<string, any>) => ({
  id: 'a1',
  type: 'comment_deadline',
  severity: 'critical',
  title: 'EPA deadline',
  subtitle: 'Federal Register',
  when: new Date().toISOString(),
  countdownDays: 2,
  countdownLabel: '2d left',
  href: '/intelligence/changes?type=reg',
  state: null,
  ...over,
});

const aggWith = (alerts: any[], alertsHiddenCount = 0): any => ({
  sections: { snapshot: { topAlerts: alerts, alertsHiddenCount } },
});

describe('TopAlertsList CTAs and row controls', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    postMock.mockClear();
  });

  test('View all CTA navigates to links.viewAllHref', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /View all/i }));
    expect(navigateMock).toHaveBeenCalledWith('/intelligence/changes?clientId=abc');
  });

  test('source mappings CTA navigates to mappings route', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /source mappings/i }));
    expect(navigateMock).toHaveBeenCalledWith('/settings/intelligence-mappings');
  });

  test('clicking an alert row drills with client filter preserved', () => {
    renderList({ aggregate: aggWith([mkAlert({ type: 'change', href: '/intelligence/changes?type=reg' })]) });
    fireEvent.click(screen.getByRole('button', { name: /EPA deadline/i }));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('clientId=abc'));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('type=reg'));
  });

  test('Acknowledge fires the alert-state mutation', async () => {
    renderList({ aggregate: aggWith([mkAlert({})]) });
    const ackBtns = screen.getAllByRole('button', { name: /Acknowledge/i });
    fireEvent.click(ackBtns[0]!);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/api/intelligence/clients/abc/alert-state',
        expect.objectContaining({ alertId: 'a1', state: 'acknowledged' }),
      ),
    );
  });

  test('Dismiss fires the alert-state mutation with dismissed', async () => {
    renderList({ aggregate: aggWith([mkAlert({})]) });
    const dismissBtns = screen.getAllByRole('button', { name: /Dismiss/i });
    fireEvent.click(dismissBtns[0]!);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/api/intelligence/clients/abc/alert-state',
        expect.objectContaining({ state: 'dismissed' }),
      ),
    );
  });

  test('comment_deadline rows expose calendar + outreach actions', () => {
    renderList({ aggregate: aggWith([mkAlert({ type: 'comment_deadline' })]) });
    expect(screen.getByRole('button', { name: /Add to calendar/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Start outreach/i })).toBeTruthy();
  });

  test('non-deadline rows expose add-to-brief and fire the brief mutation', async () => {
    renderList({ aggregate: aggWith([mkAlert({ type: 'change', countdownDays: null, countdownLabel: null })]) });
    fireEvent.click(screen.getByRole('button', { name: /Add to client brief/i }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/api/intelligence/clients/abc/briefs',
        expect.objectContaining({ sourceAlertId: 'a1', sourceType: 'change' }),
      ),
    );
  });

  test('hidden-count footer renders and navigates to view-all', () => {
    const alerts = Array.from({ length: 6 }, (_, i) => mkAlert({ id: `a${i}`, title: `Alert ${i}`, countdownDays: i + 1 }));
    renderList({ aggregate: aggWith(alerts, 3), hiddenCount: 3 });
    const more = screen.getByRole('button', { name: /3 more alerts/i });
    fireEvent.click(more);
    expect(navigateMock).toHaveBeenCalledWith('/intelligence/changes?clientId=abc');
  });

  test('deadline toggle reorders soonest-closing first', () => {
    const alerts = [
      mkAlert({ id: 'far', title: 'Far deadline', severity: 'critical', countdownDays: 12 }),
      mkAlert({ id: 'soon', title: 'Soon deadline', severity: 'info', countdownDays: 1 }),
    ];
    renderList({ aggregate: aggWith(alerts) });

    // Switch to Deadline sort.
    fireEvent.click(screen.getByText('Deadline'));
    const titles = screen.getAllByText(/deadline$/i).map((el) => el.textContent);
    // "Soon deadline" (1d) must appear before "Far deadline" (12d) in DOM order.
    const soonIdx = titles.findIndex((t) => t?.includes('Soon'));
    const farIdx = titles.findIndex((t) => t?.includes('Far'));
    expect(soonIdx).toBeLessThan(farIdx);
  });

  test('acknowledged rows render an Ack\'d badge', () => {
    renderList({ aggregate: aggWith([mkAlert({ state: 'acknowledged' })]) });
    expect(screen.getByText(/Ack'd/i)).toBeTruthy();
  });
});
