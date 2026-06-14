import { useMemo } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Card, Tabs } from 'antd';
import { ROLE_RANK, type TenantRole } from '@capiro/shared';
import { useMe } from '../../lib/me.js';

interface Tab {
  key: string;
  label: string;
  minRole?: TenantRole;
}

const TABS: Tab[] = [
  { key: '/settings/personal', label: 'Personal' },
  { key: '/settings/contact', label: 'Contact Info' },
  { key: '/settings/team', label: 'Team', minRole: 'user_admin' },
  { key: '/settings/branding', label: 'Branding', minRole: 'user_admin' },
  { key: '/settings/clients', label: 'Clients', minRole: 'user_admin' },
  { key: '/settings/integrations', label: 'Integrations' },
  { key: '/settings/billing', label: 'Billing', minRole: 'user_admin' },
  { key: '/settings/ai-usage', label: 'AI Usage', minRole: 'user_admin' },
  { key: '/settings/intelligence-mappings', label: 'Intelligence', minRole: 'user_admin' },
  { key: '/settings/skills', label: 'Skills', minRole: 'user_admin' },
  { key: '/settings/tenants', label: 'Tenants', minRole: 'capiro_admin' },
  { key: '/settings/customers', label: 'Customers', minRole: 'capiro_admin' },
];

/**
 * Settings is the single home for both personal and admin configuration.
 * Tabs are filtered by the caller's role: standard_user sees just Personal;
 * standard_user can connect personal email integrations; user_admin gains
 * Team / Branding / Clients / Billing; capiro_admin also
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
    visibleTabs[0]?.key ??
    '/settings/personal';
  return (
    <section className="settings-shell">
      <Card className="settings-panel" bordered={false}>
        <Tabs
          className="settings-tabs"
          activeKey={active}
          items={visibleTabs.map((t) => ({
            key: t.key,
            label: <Link to={t.key}>{t.label}</Link>,
          }))}
        />
        <div className="settings-content">
          <Outlet />
        </div>
      </Card>
    </section>
  );
}
