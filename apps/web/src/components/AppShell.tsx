import { useMemo, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ApartmentOutlined,
  BulbOutlined,
  CalendarOutlined,
  DashboardOutlined,
  FolderOpenOutlined,
  IdcardOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { OrganizationSwitcher, UserButton } from '@clerk/clerk-react';
import { Alert, Button, Layout, Menu, Space, Tag, Tooltip, Typography } from 'antd';
import { useMe } from '../lib/me.js';
import { useImpersonation } from '../state/impersonation.js';

const { Header, Sider, Content } = Layout;

// Brand palette per the Capiro Brand Book.
const CAPIRO_BLUE = '#01226A';
const CAPIRO_BLUE_DEEP = '#001650';
const SOFT_WHITE = '#F4F6F8';

interface NavItem {
  key: string;
  label: string;
  path: string;
  active: boolean;
  icon: ReactNode;
}

/**
 * Primary app navigation. Icons keep the collapsed rail usable while labels
 * stay available in the expanded state.
 * Active flag controls whether the route is implemented; greyed items render
 * but route to a Coming Soon placeholder.
 *
 * Admin functions live INSIDE Settings as role-conditional tabs - a
 * standard_user sees only "Personal", user_admin gains team/branding/etc.,
 * capiro_admin also sees "Tenants". See pages/settings/SettingsLayout.tsx.
 */
const NAV: NavItem[] = [
  {
    key: 'home',
    label: 'Command Center',
    path: '/',
    active: true,
    icon: <DashboardOutlined />,
  },
  {
    key: 'clients',
    label: 'Clients',
    path: '/clients',
    active: true,
    icon: <ApartmentOutlined />,
  },
  {
    key: 'engagement',
    label: 'Engagement Manager',
    path: '/engagement',
    active: true,
    icon: <CalendarOutlined />,
  },
  {
    key: 'workspace',
    label: 'Workspace',
    path: '/workspace',
    active: false,
    icon: <FolderOpenOutlined />,
  },
  {
    key: 'intelligence',
    label: 'Intelligence',
    path: '/intelligence',
    active: false,
    icon: <BulbOutlined />,
  },
  {
    key: 'directory',
    label: 'Directory',
    path: '/directory',
    active: true,
    icon: <IdcardOutlined />,
  },
  {
    key: 'portal',
    label: 'Client Portal',
    path: '/portal',
    active: false,
    icon: <UserSwitchOutlined />,
  },
  {
    key: 'settings',
    label: 'Settings',
    path: '/settings',
    active: true,
    icon: <SettingOutlined />,
  },
];

export function AppShell() {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const { actAsTenantSlug, end: endImpersonation } = useImpersonation();

  const items = useMemo(
    () =>
      NAV.map((n) => ({
        key: n.key,
        disabled: !n.active,
        icon: n.icon,
        title: n.label,
        label: n.active ? (
          <Link to={n.path} style={{ color: 'inherit' }}>
            {n.label}
          </Link>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>{n.label}</span>
        ),
      })),
    [],
  );

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    const match = NAV.find((n) => path === n.path || (n.path !== '/' && path.startsWith(n.path)));
    return match?.key ?? 'home';
  }, [location.pathname]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={240}
        collapsed={collapsed}
        collapsedWidth={76}
        collapsible
        trigger={null}
        breakpoint="lg"
        onBreakpoint={setCollapsed}
        style={{
          background: CAPIRO_BLUE,
          color: '#fff',
        }}
      >
        <div
          onClick={() => navigate('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            height: 72,
            padding: collapsed ? '0 12px' : '0 18px 0 24px',
            cursor: 'pointer',
            borderBottom: `1px solid rgba(255,255,255,0.06)`,
            gap: 12,
          }}
        >
          <Typography.Text
            style={{
              color: '#fff',
              fontSize: collapsed ? 22 : 24,
              fontWeight: 700,
              letterSpacing: 0,
              lineHeight: 1,
            }}
          >
            {collapsed ? 'C' : 'Capiro'}
          </Typography.Text>
          {!collapsed ? (
            <Tooltip title="Collapse navigation" placement="right">
              <Button
                aria-label="Collapse navigation"
                icon={<MenuFoldOutlined />}
                type="text"
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  setCollapsed(true);
                }}
                style={{
                  color: '#fff',
                  background: 'rgba(255,255,255,0.08)',
                  borderRadius: 8,
                }}
              />
            </Tooltip>
          ) : null}
        </div>
        {collapsed ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
            <Tooltip title="Expand navigation" placement="right">
              <Button
                aria-label="Expand navigation"
                icon={<MenuUnfoldOutlined />}
                type="text"
                onClick={() => setCollapsed(false)}
                style={{
                  color: '#fff',
                  background: 'rgba(255,255,255,0.08)',
                  borderRadius: 8,
                }}
              />
            </Tooltip>
          </div>
        ) : null}
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          inlineIndent={24}
          style={{
            background: CAPIRO_BLUE,
            borderRight: 0,
            paddingTop: collapsed ? 12 : 16,
          }}
        />
      </Sider>
      <Layout style={{ background: SOFT_WHITE }}>
        <Header
          style={{
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #e3e6ec',
            padding: '0 24px',
            height: 72,
          }}
        >
          <Space>
            {me.data ? (
              <>
                <Typography.Text strong>{me.data.tenant.slug}</Typography.Text>
                <Tag color={me.data.role === 'capiro_admin' ? 'volcano' : 'blue'}>
                  {me.data.role.replace(/_/g, ' ')}
                </Tag>
                {actAsTenantSlug ? (
                  <Tag color="purple" closable onClose={endImpersonation}>
                    impersonating {actAsTenantSlug}
                  </Tag>
                ) : null}
              </>
            ) : null}
          </Space>
          <Space size="middle">
            <OrganizationSwitcher hidePersonal />
            <UserButton afterSignOutUrl="/sign-in" />
          </Space>
        </Header>
        <Content style={{ padding: 24 }}>
          {me.error ? (
            <Alert
              type="error"
              message="Could not load your profile"
              description={(me.error as Error).message}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
