import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  ProfileOutlined,
  ProjectOutlined,
  WarningOutlined,
} from '@ant-design/icons';
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
  { path: '/workspace/overview', label: 'Overview', icon: <ProfileOutlined /> },
  { path: '/workspace/library', label: 'Library', icon: <AppstoreOutlined /> },
  { path: '/workspace/workflows', label: 'Workflows', icon: <ProjectOutlined /> },
  { path: '/workspace/strategies', label: 'Strategies', icon: <ApartmentOutlined /> },
] as const;

export function WorkspaceLayout() {
  const location = useLocation();
  const api = useApi();

  const activeTab =
    TABS.find((tab) => location.pathname.startsWith(tab.path))?.path ??
    (location.pathname.startsWith('/workspace/strategy') ? '/workspace/strategies' : undefined);

  const { data: deadlines } = useQuery<DeadlineItem[]>({
    queryKey: ['strategy-deadlines'],
    queryFn: () => api.get('/api/strategies/deadlines').then((response) => response.data),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const upcoming = (deadlines ?? []).filter((deadline) => deadline.daysUntil <= 14);

  return (
    <div className="workspace-layout">
      {upcoming.length > 0 && (
        <div className="deadline-bar">
          <WarningOutlined />
          <span>
            {upcoming.length} deadline{upcoming.length !== 1 ? 's' : ''} in the next 14 days:
          </span>
          {upcoming.slice(0, 3).map((deadline) => (
            <Link
              key={deadline.instanceId}
              to={`/workspace/strategy/${deadline.strategyId}`}
              className="deadline-item"
            >
              {deadline.templateName}, {deadline.deadline} ({deadline.daysUntil}d)
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
