import { Link, Outlet, useLocation } from 'react-router-dom';
import { ApartmentOutlined, AppstoreOutlined, ProjectOutlined, RobotOutlined } from '@ant-design/icons';

const TABS = [
  { path: '/workspace/catalog', label: 'Library', icon: <AppstoreOutlined /> },
  { path: '/workspace/kanban', label: 'Workflows', icon: <ProjectOutlined /> },
  { path: '/workspace/strategies', label: 'Strategies', icon: <ApartmentOutlined /> },
  { path: '/workspace/clio', label: 'Clio', icon: <RobotOutlined /> },
] as const;

export function WorkspaceLayout() {
  const location = useLocation();
  const activeTab =
    TABS.find((t) => location.pathname.startsWith(t.path))?.path ??
    (location.pathname.startsWith('/workspace/strategy') ? '/workspace/strategies' : undefined);

  return (
    <div className="workspace-layout">
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
