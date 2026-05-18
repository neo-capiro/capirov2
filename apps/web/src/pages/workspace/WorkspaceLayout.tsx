import { Link, Outlet, useLocation } from 'react-router-dom';
import { ApartmentOutlined, AppstoreOutlined, ProjectOutlined, RobotOutlined, WarningOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';

interface DeadlineItem {
  strategyId: string;
  strategyName: string;
  clientName: string;
  templateSlug: string;
  templateName: string;
  deadline: string;
  deadlineLabel: string;
  daysUntil: number;
  instanceId: string;
  instanceStatus: string;
}

const TABS = [
  { path: '/workspace/catalog', label: 'Library', icon: <AppstoreOutlined /> },
  { path: '/workspace/kanban', label: 'Workflows', icon: <ProjectOutlined /> },
  { path: '/workspace/strategies', label: 'Strategies', icon: <ApartmentOutlined /> },
  { path: '/workspace/clio', label: 'Clio', icon: <RobotOutlined /> },
] as const;

export function WorkspaceLayout() {
  const location = useLocation();
  const api = useApi();

  const activeTab =
    TABS.find((t) => location.pathname.startsWith(t.path))?.path ??
    (location.pathname.startsWith('/workspace/strategy') ? '/workspace/strategies' : undefined);

  const { data: deadlines } = useQuery<DeadlineItem[]>({
    queryKey: ['strategy-deadlines'],
    queryFn: () => api.get('/api/strategies/deadlines').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const upcoming = (deadlines ?? []).filter((d) => d.daysUntil <= 14);

  return (
    <div className="workspace-layout">
      {upcoming.length > 0 && (
        <div className="deadline-bar">
          <WarningOutlined />
          <span>{upcoming.length} deadline{upcoming.length !== 1 ? 's' : ''} in the next 14 days:</span>
          {upcoming.slice(0, 3).map((d) => (
            <Link
              key={d.instanceId}
              to={`/workspace/strategy/${d.strategyId}`}
              className="deadline-item"
            >
              {d.templateName} — {d.deadline} ({d.daysUntil}d)
            </Link>
          ))}
          {upcoming.length > 3 && (
            <Link to="/workspace/strategies" className="deadline-item deadline-item--more">
              +{upcoming.length - 3} more
            </Link>
          )}
        </div>
      )}
      <nav className="workspace-tabs" aria-label="Workspace sections">
        {TABS.map((tab) => (
          <Link
            key={tab.path}
            to={tab.path}
            className={`workspace-tab${activeTab === tab.path ? ' is-active' : ''}`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
