import { Link, Outlet, useLocation } from 'react-router-dom';
import { Card, Tabs, Typography } from 'antd';

const TABS = [
  { key: '/admin/team', label: 'Team' },
  { key: '/admin/branding', label: 'Branding' },
  { key: '/admin/clients', label: 'Clients' },
  { key: '/admin/billing', label: 'Billing' },
];

export function AdminLayout() {
  const location = useLocation();
  const active =
    TABS.find((t) => location.pathname.startsWith(t.key))?.key ?? TABS[0]!.key;
  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Admin Panel
      </Typography.Title>
      <Card>
        <Tabs
          activeKey={active}
          items={TABS.map((t) => ({
            key: t.key,
            label: <Link to={t.key}>{t.label}</Link>,
          }))}
        />
        <Outlet />
      </Card>
    </>
  );
}
