import { useMemo } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Card, Tabs, Typography } from 'antd';
import { ROLE_RANK, type TenantRole } from '@capiro/shared';
import { useMe } from '../../lib/me.js';

interface Tab {
  key: string;
  label: string;
  minRole?: TenantRole;
}

const TABS: Tab[] = [
  { key: '/settings/personal', label: 'Personal' },
  { key: '/settings/team', label: 'Team', minRole: 'user_admin' },
  { key: '/settings/branding', label: 'Branding', minRole: 'user_admin' },
  { key: '/settings/clients', label: 'Clients', minRole: 'user_admin' },
  { key: '/settings/integrations', label: 'Integrations', minRole: 'user_admin' },
  { key: '/settings/billing', label: 'Billing', minRole: 'user_admin' },
  { key: '/settings/tenants', label: 'Tenants', minRole: 'capiro_admin' },
];

/**
 * Settings is the single home for both personal and admin configuration.
 * Tabs are filtered by the caller's role: standard_user sees just Personal;
 * user_admin gains Team / Branding / Clients / Billing; capiro_admin also
 * sees Tenants (cross-tenant management + impersonation).
 *
 * The server-side RolesGuard on every endpoint is the security boundary;
 * this filter is purely UI affordance.
 */
export function SettingsLayout() {
  const me = useMe();
  const location = useLocation();
  const visibleTabs = useMemo(() => {
    if (!me.data) return [];
    return TABS.filter((t) => {
      if (!t.minRole) return true;
      return ROLE_RANK[me.data.role] >= ROLE_RANK[t.minRole];
    });
  }, [me.data]);
  const active =
    visibleTabs.find((t) => location.pathname.startsWith(t.key))?.key ??
    visibleTabs[0]?.key ?? '/settings/personal';
  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Settings
      </Typography.Title>
      <Card>
        <Tabs
          activeKey={active}
          items={visibleTabs.map((t) => ({
            key: t.key,
            label: <Link to={t.key}>{t.label}</Link>,
          }))}
        />
        <Outlet />
      </Card>
    </>
  );
}
