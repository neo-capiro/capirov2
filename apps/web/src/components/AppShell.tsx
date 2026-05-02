import { useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { OrganizationSwitcher, UserButton } from '@clerk/clerk-react';
import {
  ApiOutlined,
  AppstoreOutlined,
  BankOutlined,
  BookOutlined,
  ContactsOutlined,
  DashboardOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { Alert, Layout, Menu, Space, Tag, Typography } from 'antd';
import { ROLE_RANK, type TenantRole } from '@capiro/shared';
import { useMe } from '../lib/me.js';
import { useImpersonation } from '../state/impersonation.js';

const { Header, Sider, Content } = Layout;

interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  active: boolean; // Whether the page is implemented for MVP
  minRole?: TenantRole;
}

/**
 * Eight top-level destinations per the architecture doc §5.3. Five active
 * (Command Center, Clients, Engagement Manager, Directory, Settings); three
 * placeholder (Workspace, Intelligence Hub, Client Portal).
 *
 * Two extra admin destinations only render for the matching role:
 *   Admin Panel    user_admin+
 *   Capiro Admin   capiro_admin only
 */
const NAV: NavItem[] = [
  { key: 'home', label: 'Command Center', path: '/', icon: <DashboardOutlined />, active: true },
  { key: 'clients', label: 'Clients', path: '/clients', icon: <ContactsOutlined />, active: true },
  {
    key: 'engagement',
    label: 'Engagement Manager',
    path: '/engagement',
    icon: <ApiOutlined />,
    active: true,
  },
  {
    key: 'workspace',
    label: 'Workspace',
    path: '/workspace',
    icon: <AppstoreOutlined />,
    active: false,
  },
  { key: 'hub', label: 'Intelligence Hub', path: '/hub', icon: <BookOutlined />, active: false },
  { key: 'directory', label: 'Directory', path: '/directory', icon: <TeamOutlined />, active: true },
  {
    key: 'portal',
    label: 'Client Portal',
    path: '/portal',
    icon: <BankOutlined />,
    active: false,
  },
  { key: 'settings', label: 'Settings', path: '/settings', icon: <SettingOutlined />, active: true },
];

const ADMIN_NAV: NavItem[] = [
  {
    key: 'admin',
    label: 'Admin Panel',
    path: '/admin',
    icon: <ToolOutlined />,
    active: true,
    minRole: 'user_admin',
  },
  {
    key: 'capiro-admin',
    label: 'Capiro Admin',
    path: '/capiro-admin',
    icon: <BankOutlined />,
    active: true,
    minRole: 'capiro_admin',
  },
];

export function AppShell() {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const { actAsTenantSlug, end: endImpersonation } = useImpersonation();

  const items = useMemo(() => {
    const visible = [
      ...NAV,
      ...ADMIN_NAV.filter((n) => {
        if (!me.data) return false;
        return n.minRole ? ROLE_RANK[me.data.role] >= ROLE_RANK[n.minRole] : true;
      }),
    ];
    return visible.map((n) => ({
      key: n.key,
      icon: n.icon,
      disabled: !n.active,
      label: n.active ? (
        <Link to={n.path}>{n.label}</Link>
      ) : (
        <Space size={6}>
          <span>{n.label}</span>
          <Tag color="default" style={{ fontSize: 10, lineHeight: '14px' }}>
            soon
          </Tag>
        </Space>
      ),
    }));
  }, [me.data]);

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    const match = [...NAV, ...ADMIN_NAV].find(
      (n) => path === n.path || (n.path !== '/' && path.startsWith(n.path)),
    );
    return match?.key ?? 'home';
  }, [location.pathname]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={240}
        breakpoint="lg"
        collapsedWidth={64}
        style={{ background: '#01226a', color: '#fff' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 64,
            color: '#fff',
            fontWeight: 700,
            letterSpacing: 0.6,
            fontSize: 18,
            cursor: 'pointer',
          }}
          onClick={() => navigate('/')}
        >
          Capiro
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          style={{ background: '#01226a', borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            padding: '0 24px',
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
            />
          ) : null}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
