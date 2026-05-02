import { useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { OrganizationSwitcher, UserButton } from '@clerk/clerk-react';
import { Alert, Layout, Menu, Space, Tag, Typography } from 'antd';
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
}

/**
 * Primary nav per the design mock (no icons; clean wordmark-only style).
 * Active flag controls whether the route is implemented; greyed items render
 * but route to a Coming Soon placeholder.
 *
 * Admin functions live INSIDE Settings as role-conditional tabs — a
 * standard_user sees only "Personal", user_admin gains team/branding/etc.,
 * capiro_admin also sees "Tenants". See pages/settings/SettingsLayout.tsx.
 */
const NAV: NavItem[] = [
  { key: 'home', label: 'Command Center', path: '/', active: true },
  { key: 'clients', label: 'Clients', path: '/clients', active: true },
  { key: 'engagement', label: 'Engagement Manager', path: '/engagement', active: true },
  { key: 'workspace', label: 'Workspace', path: '/workspace', active: false },
  { key: 'intelligence', label: 'Intelligence', path: '/intelligence', active: false },
  { key: 'directory', label: 'Directory', path: '/directory', active: true },
  { key: 'portal', label: 'Client Portal', path: '/portal', active: false },
  { key: 'settings', label: 'Settings', path: '/settings', active: true },
];

export function AppShell() {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const { actAsTenantSlug, end: endImpersonation } = useImpersonation();

  const items = useMemo(
    () =>
      NAV.map((n) => ({
        key: n.key,
        disabled: !n.active,
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
        breakpoint="lg"
        collapsedWidth={0}
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
            justifyContent: 'flex-start',
            height: 72,
            padding: '0 24px',
            cursor: 'pointer',
            borderBottom: `1px solid rgba(255,255,255,0.06)`,
          }}
        >
          <Typography.Text
            style={{
              color: '#fff',
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 0.4,
            }}
          >
            Capiro
          </Typography.Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          inlineIndent={24}
          style={{
            background: CAPIRO_BLUE,
            borderRight: 0,
            paddingTop: 16,
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
