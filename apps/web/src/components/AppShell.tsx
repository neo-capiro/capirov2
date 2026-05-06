import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ApartmentOutlined,
  BulbOutlined,
  CalendarOutlined,
  CheckOutlined,
  DashboardOutlined,
  DownOutlined,
  FolderOpenOutlined,
  IdcardOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  SyncOutlined,
  UserOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { useClerk, useUser } from '@clerk/clerk-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Avatar,
  Button,
  Dropdown,
  Input,
  Layout,
  Menu,
  Popover,
  Space,
  Typography,
  type MenuProps,
} from 'antd';
import { useMe } from '../lib/me.js';
import { useApi } from '../lib/use-api.js';
import { useClientFilter } from '../state/client-filter.js';
import { useImpersonation } from '../state/impersonation.js';
import type { Client } from '../pages/clients/clientTypes.js';

const { Header, Sider, Content } = Layout;

interface NavItem {
  key: AppSection;
  label: string;
  path: string;
  icon: ReactNode;
  nested?: boolean;
}

type AppSection =
  | 'home'
  | 'clients'
  | 'engagement'
  | 'workspace'
  | 'intelligence'
  | 'directory'
  | 'portal'
  | 'settings'
  | 'not-found';

interface PageConfig {
  key: AppSection;
  title: string;
  showClientDropdown: boolean;
}

interface IntegrationConnection {
  id: string;
  provider: 'microsoft_365' | 'google_workspace' | 'imap_caldav' | 'manual';
  accountEmail: string | null;
  displayName: string | null;
  status: 'needs_configuration' | 'connected' | 'error' | 'disabled';
  lastSyncAt: string | null;
}

interface BrandingResponse {
  id: string;
  slug: string;
  name: string;
  logoS3Key: string | null;
  logoContentType: string | null;
  logoUploadedAt: string | null;
  logoUrl?: string | null;
}

const NAV: NavItem[] = [
  { key: 'home', label: 'Command Center', path: '/', icon: <DashboardOutlined /> },
  { key: 'clients', label: 'Clients', path: '/clients', icon: <ApartmentOutlined /> },
  {
    key: 'engagement',
    label: 'Engagement Manager',
    path: '/engagement',
    icon: <CalendarOutlined />,
    nested: true,
  },
  { key: 'workspace', label: 'Workspace', path: '/workspace', icon: <FolderOpenOutlined /> },
  { key: 'intelligence', label: 'Intelligence', path: '/intelligence', icon: <BulbOutlined /> },
  { key: 'directory', label: 'Directory', path: '/directory', icon: <IdcardOutlined /> },
  { key: 'portal', label: 'Client Portal', path: '/portal', icon: <UserSwitchOutlined /> },
];

export function AppShell() {
  const api = useApi();
  const me = useMe();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const { signOut, openUserProfile } = useClerk();
  const { user } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const { actAsTenantSlug, end: endImpersonation } = useImpersonation();
  const { selectedClientId, setSelectedClientId, clearClientFilter } = useClientFilter();
  const previousSection = useRef<AppSection | null>(null);
  const [lastManualSyncAt, setLastManualSyncAt] = useState<string | null>(null);
  const [workflowLocked, setWorkflowLocked] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ locked?: boolean }>).detail;
      setWorkflowLocked(Boolean(detail?.locked));
    };
    window.addEventListener('capiro:workflow-lock', handler);
    return () => window.removeEventListener('capiro:workflow-lock', handler);
  }, []);

  const displayName =
    user?.fullName ||
    [me.data?.user.firstName, me.data?.user.lastName].filter(Boolean).join(' ') ||
    me.data?.user.email ||
    user?.primaryEmailAddress?.emailAddress ||
    'Account';

  const page = useMemo(() => pageConfigFor(location.pathname), [location.pathname]);

  const clients = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: async () => (await api.get<Client[]>('/api/clients')).data,
    enabled: Boolean(me.data),
    staleTime: 60_000,
  });

  const branding = useQuery<BrandingResponse | null>({
    queryKey: ['branding'],
    queryFn: async () => (await api.get<BrandingResponse | null>('/api/tenant-admin/branding')).data,
    enabled: Boolean(me.data),
    staleTime: 240_000,
    refetchInterval: 240_000,
  });

  const visibleClients = useMemo(
    () =>
      (clients.data ?? [])
        .filter((client) => client.status !== 'archived')
        .sort((left, right) => left.name.localeCompare(right.name)),
    [clients.data],
  );
  const selectedClient = visibleClients.find((client) => client.id === selectedClientId) ?? null;

  useEffect(() => {
    if (
      previousSection.current &&
      previousSection.current !== page.key &&
      previousSection.current !== 'directory' &&
      page.key !== 'directory'
    ) {
      clearClientFilter();
    }
    previousSection.current = page.key;
  }, [clearClientFilter, page.key]);

  useEffect(() => {
    if (!selectedClientId || clients.isLoading) return;
    if (!visibleClients.some((client) => client.id === selectedClientId)) {
      clearClientFilter();
    }
  }, [clearClientFilter, clients.isLoading, selectedClientId, visibleClients]);

  const integrationConnections = useQuery<IntegrationConnection[]>({
    queryKey: ['engagement-integrations'],
    queryFn: async () =>
      (await api.get<IntegrationConnection[]>('/api/engagement/integrations')).data,
    enabled: Boolean(me.data),
    staleTime: 30_000,
  });

  const connectedInboxConnections = useMemo(
    () =>
      (integrationConnections.data ?? []).filter(
        (connection) =>
          connection.provider === 'microsoft_365' && connection.status === 'connected',
      ),
    [integrationConnections.data],
  );

  const syncInbox = useMutation({
    mutationFn: async (_options?: { silent?: boolean }) => {
      if (!connectedInboxConnections.length) {
        throw new Error('Connect your inbox before syncing.');
      }
      const syncWindow = defaultInboxSyncWindow();
      for (const connection of connectedInboxConnections) {
        await api.post(
          `/api/engagement/integrations/microsoft/${connection.id}/calendar-window`,
          undefined,
          { params: { from: syncWindow.from, to: syncWindow.to } },
        );
        await api.post(`/api/engagement/integrations/microsoft/${connection.id}/sync`, undefined, {
          params: { calendar: 'false', mail: 'true' },
        });
      }
    },
    onSuccess: (_data, options) => {
      setLastManualSyncAt(new Date().toISOString());
      if (!options?.silent) message.success('Inbox synced');
      qc.invalidateQueries({ queryKey: ['engagement-integrations'] });
      qc.invalidateQueries({ queryKey: ['engagement-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-calendar-meetings'] });
      qc.invalidateQueries({ queryKey: ['engagement-mail-threads'] });
      qc.invalidateQueries({ queryKey: ['engagement-client-context'] });
      qc.invalidateQueries({ queryKey: ['engagement-report'] });
      qc.invalidateQueries({ queryKey: ['command-meetings'] });
      qc.invalidateQueries({ queryKey: ['command-tasks'] });
      qc.invalidateQueries({ queryKey: ['command-mail-threads'] });
      qc.invalidateQueries({ queryKey: ['client-meetings'] });
      qc.invalidateQueries({ queryKey: ['client-mail-threads'] });
    },
    onError: (err, options) => {
      if (!options?.silent) message.error(errorMessage(err));
    },
  });

  useEffect(() => {
    if (!connectedInboxConnections.length) return undefined;
    syncInbox.mutate({ silent: true });
    const timer = window.setInterval(() => syncInbox.mutate({ silent: true }), 15 * 60_000);
    return () => window.clearInterval(timer);
  }, [connectedInboxConnections.length, syncInbox.mutate]);

  useEffect(() => {
    const handler = () => {
      if (!connectedInboxConnections.length) {
        navigate('/settings/integrations');
        return;
      }
      syncInbox.mutate({ silent: false });
    };
    window.addEventListener('capiro:sync-inbox', handler);
    return () => window.removeEventListener('capiro:sync-inbox', handler);
  }, [connectedInboxConnections.length, navigate, syncInbox]);

  const items = useMemo(
    () =>
      NAV.map((n) => ({
        key: n.key,
        icon: n.icon,
        title: n.label,
        className: n.nested ? 'app-nav-item--nested' : undefined,
        label: (
          <Link
            to={n.path}
            style={{ color: 'inherit' }}
            onClick={(event) => {
              if (!workflowLocked) return;
              event.preventDefault();
              message.info('Cancel or complete the outreach workflow before navigating away.');
            }}
          >
            {n.label}
          </Link>
        ),
      })),
    [message, workflowLocked],
  );

  const selectedKey = page.key === 'not-found' ? 'home' : page.key;

  const accountMenu: MenuProps = {
    items: [
      { key: 'profile', label: 'Profile' },
      { key: 'logout', label: 'Log out' },
    ],
    onClick: ({ key }) => {
      if (key === 'profile') {
        openUserProfile();
        return;
      }
      void signOut({ redirectUrl: '/sign-in' });
    },
  };

  return (
    <Layout className="app-shell">
      <Sider
        width={240}
        collapsedWidth={72}
        collapsed={navCollapsed}
        trigger={null}
        className="app-shell-sider"
      >
        <nav className="app-shell-nav" aria-label="Primary navigation">
          <div className="app-shell-brand-row">
            <button
              className="app-shell-brand"
              type="button"
              onClick={() => {
                if (workflowLocked) {
                  message.info('Cancel or complete the outreach workflow before navigating away.');
                  return;
                }
                navigate('/');
              }}
              aria-label="Go to Command Center"
            >
              {navCollapsed ? (
                <span className="app-shell-logo-mark">C</span>
              ) : (
                <img src="/logo.png" alt="Capiro" className="app-shell-logo" />
              )}
            </button>
            <button
              className="app-shell-collapse"
              type="button"
              aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              onClick={() => setNavCollapsed((value) => !value)}
            >
              {navCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
          </div>

          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={items}
            inlineIndent={24}
            className="app-nav-menu"
          />

          <div className="app-shell-bottom">
            <SyncInboxControl
              connections={connectedInboxConnections}
              loading={integrationConnections.isLoading}
              queryError={integrationConnections.isError}
              syncing={syncInbox.isPending}
              syncError={syncInbox.isError}
              lastManualSyncAt={lastManualSyncAt}
              onClick={() => {
                if (!connectedInboxConnections.length) {
                  navigate('/settings/integrations');
                  return;
                }
                syncInbox.mutate({ silent: false });
              }}
            />

            <Link
              to="/settings"
              className={`app-bottom-nav-item${selectedKey === 'settings' ? ' is-active' : ''}`}
              onClick={(event) => {
                if (!workflowLocked) return;
                event.preventDefault();
                message.info('Cancel or complete the outreach workflow before navigating away.');
              }}
            >
              <SettingOutlined />
              <span>Settings</span>
            </Link>
          </div>
        </nav>
      </Sider>

      <Layout className="app-main-layout">
        <Header className="app-topbar">
          <TopbarTenantBrand
            logoUrl={branding.data?.logoUrl ?? null}
            name={branding.data?.name ?? me.data?.tenant.name ?? 'Capiro'}
          />
          <span className="app-topbar-spacer" />
          <button
            className="app-topbar-icon-button"
            type="button"
            aria-label="Open settings"
            onClick={() => {
              if (workflowLocked) {
                message.info('Cancel or complete the outreach workflow before navigating away.');
                return;
              }
              navigate('/settings');
            }}
          >
            <SettingOutlined />
          </button>
          <Dropdown menu={accountMenu} trigger={['click']} placement="bottomRight">
            <button className="app-topbar-account" type="button" aria-label="Open account menu">
              <Avatar size={30} src={user?.imageUrl || undefined} icon={<UserOutlined />}>
                {initials(displayName)}
              </Avatar>
            </button>
          </Dropdown>
        </Header>

        <div className="app-page-header">
          <Typography.Text className="app-page-title" role="heading" aria-level={1}>
            {page.title}
          </Typography.Text>
          {page.showClientDropdown ? (
            <>
              <span className="app-page-header-divider" aria-hidden="true" />
              <ClientDropdown
                clients={visibleClients}
                selectedClient={selectedClient}
                selectedClientId={selectedClientId}
                loading={clients.isLoading}
                onSelect={setSelectedClientId}
                onNavigateToClients={() => navigate('/clients')}
              />
            </>
          ) : null}
          <span className="app-page-header-spacer" />
          <PageActions page={page.key} />
        </div>

        {page.showClientDropdown && selectedClient ? (
          <ClientContextBanner client={selectedClient} onClear={clearClientFilter} />
        ) : null}

        <Content className="app-content">
          {me.error ? (
            <Alert
              type="error"
              message="Could not load your profile"
              description={(me.error as Error).message}
              className="app-content-alert"
            />
          ) : null}
          {actAsTenantSlug ? (
            <Alert
              type="info"
              showIcon
              closable
              message="Impersonation active"
              description={`You are viewing ${actAsTenantSlug}.`}
              onClose={endImpersonation}
              className="app-content-alert"
            />
          ) : null}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}

function TopbarTenantBrand({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  return (
    <div className="app-topbar-tenant-brand" aria-label={`Current company: ${name}`}>
      <span className="app-topbar-tenant-logo">
        {logoUrl ? <img src={logoUrl} alt={`${name} logo`} /> : initials(name)}
      </span>
      <span className="app-topbar-tenant-name">{name}</span>
    </div>
  );
}

function ClientDropdown({
  clients,
  selectedClient,
  selectedClientId,
  loading,
  onSelect,
  onNavigateToClients,
}: {
  clients: Client[];
  selectedClient: Client | null;
  selectedClientId: string | null;
  loading: boolean;
  onSelect: (clientId: string | null) => void;
  onNavigateToClients: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchable = clients.length > 10;
  const normalizedSearch = search.trim().toLowerCase();
  const filteredClients = normalizedSearch
    ? clients.filter((client) => client.name.toLowerCase().includes(normalizedSearch))
    : clients;

  const handleSelect = (clientId: string | null) => {
    onSelect(clientId);
    setOpen(false);
  };

  const content = (
    <div
      className="app-client-menu"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        className="app-client-menu-row-button"
        type="button"
        onClick={() => handleSelect(null)}
      >
        <span>All clients</span>
        {!selectedClientId ? <CheckOutlined /> : null}
      </button>
      <span className="app-client-menu-divider" />
      {searchable ? (
        <Input
          allowClear
          autoFocus
          className="app-client-menu-search"
          placeholder="Search clients..."
          prefix={<SearchOutlined />}
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        />
      ) : null}
      <div className="app-client-menu-list">
        {clients.length ? (
          filteredClients.length ? (
            filteredClients.map((client) => (
              <button
                className="app-client-menu-row-button"
                key={client.id}
                type="button"
                onClick={() => handleSelect(client.id)}
              >
                <span className="app-client-menu-name">
                  <Avatar size={22} src={client.logoUrl || undefined}>
                    {initials(client.name)}
                  </Avatar>
                  <span>{client.name}</span>
                </span>
                {selectedClientId === client.id ? <CheckOutlined /> : null}
              </button>
            ))
          ) : (
            <Typography.Text className="app-client-menu-empty" type="secondary">
              No matching clients
            </Typography.Text>
          )
        ) : (
          <button
            className="app-client-menu-empty-button"
            type="button"
            onClick={onNavigateToClients}
          >
            No clients yet - add one in the Clients section
          </button>
        )}
      </div>
    </div>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      open={open}
      overlayClassName="app-client-popover"
      placement="bottomLeft"
      trigger="click"
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setSearch('');
      }}
    >
      <button className="app-client-dropdown-trigger" type="button">
        {selectedClient ? (
          <>
            <Avatar size={24} src={selectedClient.logoUrl || undefined}>
              {initials(selectedClient.name)}
            </Avatar>
            <span>{selectedClient.name}</span>
          </>
        ) : (
          <span>{loading ? 'Loading clients...' : 'All clients'}</span>
        )}
        <DownOutlined />
      </button>
    </Popover>
  );
}

function ClientContextBanner({ client, onClear }: { client: Client; onClear: () => void }) {
  return (
    <div className="app-client-context-banner">
      <span className="app-client-context-label">Viewing:</span>
      <Avatar size={22} src={client.logoUrl || undefined}>
        {initials(client.name)}
      </Avatar>
      <strong>{client.name}</strong>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={onClear}>
        Clear filter
      </button>
      <span className="app-client-context-spacer" />
      <span className="app-client-context-count">Showing data for 1 client</span>
    </div>
  );
}

function PageActions({ page }: { page: AppSection }) {
  if (page === 'clients') {
    return (
      <Space size={10}>
        <Button onClick={() => window.dispatchEvent(new Event('capiro:client-filter-sort'))}>
          Filter / Sort
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => window.dispatchEvent(new Event('capiro:new-client'))}
        >
          New Client
        </Button>
      </Space>
    );
  }
  return null;
}

function SyncInboxControl({
  connections,
  loading,
  queryError,
  syncing,
  syncError,
  lastManualSyncAt,
  onClick,
}: {
  connections: IntegrationConnection[];
  loading: boolean;
  queryError: boolean;
  syncing: boolean;
  syncError: boolean;
  lastManualSyncAt: string | null;
  onClick: () => void;
}) {
  const connected = connections.length > 0;
  const lastSyncAt = latestSyncAt(connections, lastManualSyncAt);
  const status = syncStatus({ connected, loading, queryError, syncing, syncError, lastSyncAt });

  return (
    <button className="app-sync-control" type="button" onClick={onClick}>
      {status.dot ? <span className={`app-sync-dot app-sync-dot--${status.dot}`} /> : null}
      <span>
        <span className="app-sync-label">{status.label}</span>
        {status.text ? <span className="app-sync-status">{status.text}</span> : null}
      </span>
      {connected ? <SyncOutlined className="app-sync-icon" /> : null}
    </button>
  );
}

function syncStatus({
  connected,
  loading,
  queryError,
  syncing,
  syncError,
  lastSyncAt,
}: {
  connected: boolean;
  loading: boolean;
  queryError: boolean;
  syncing: boolean;
  syncError: boolean;
  lastSyncAt: string | null;
}): { label: string; text: string; dot: 'green' | 'yellow' | 'red' | null } {
  if (loading) return { label: 'Connect inbox', text: '', dot: null };
  if (!connected && !queryError) return { label: 'Connect inbox', text: '', dot: null };
  if (syncing) return { label: 'Sync Inbox', text: 'Syncing inbox...', dot: 'yellow' };
  if (queryError || syncError) {
    return {
      label: connected ? 'Sync Inbox' : 'Connect inbox',
      text: 'Sync failed - tap to retry',
      dot: 'red',
    };
  }
  return { label: 'Sync Inbox', text: lastSyncText(lastSyncAt), dot: 'green' };
}

function pageKeyFor(pathname: string): AppSection {
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/clients')) return 'clients';
  if (pathname.startsWith('/engagement')) return 'engagement';
  if (pathname.startsWith('/workspace')) return 'workspace';
  if (pathname.startsWith('/intelligence')) return 'intelligence';
  if (pathname.startsWith('/directory')) return 'directory';
  if (pathname.startsWith('/portal')) return 'portal';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'not-found';
}

function pageConfigFor(pathname: string): PageConfig {
  const key = pageKeyFor(pathname);
  const titleByKey: Record<AppSection, string> = {
    home: 'Command Center',
    clients: 'Clients',
    engagement: 'Engagement Manager',
    workspace: 'Workspace',
    intelligence: 'Intelligence',
    directory: 'Directory',
    portal: 'Client Portal',
    settings: 'Settings',
    'not-found': 'Not found',
  };
  const showClientDropdown =
    key === 'home' ||
    key === 'engagement' ||
    pathname.startsWith('/workspace/library') ||
    pathname.startsWith('/workspace/submissions');
  return { key, title: titleByKey[key], showClientDropdown };
}

function latestSyncAt(
  connections: IntegrationConnection[],
  lastManualSyncAt: string | null,
): string | null {
  const timestamps = [...connections.map((connection) => connection.lastSyncAt), lastManualSyncAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function lastSyncText(value: string | null): string {
  if (!value) return 'Not yet synced';
  const diffMs = Math.max(0, Date.now() - new Date(value).getTime());
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return 'Last synced: just now';
  if (diffMinutes < 60) return `Last synced: ${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  return `Last synced: ${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
}

function defaultInboxSyncWindow(): { from: string; to: string } {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 14);
  return { from: from.toISOString(), to: to.toISOString() };
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'C';
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() || 'C';
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || 'C';
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { message?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(', ');
  }
  return error instanceof Error ? error.message : 'Request failed';
}
