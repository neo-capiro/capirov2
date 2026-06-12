import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { SignIn, SignUp, useAuth } from '@clerk/clerk-react';
import { config } from './env.js';
import { AppShell } from './components/AppShell.js';
import { PlaceholderPage } from './pages/PlaceholderPage.js';
import { SettingsLayout } from './pages/settings/SettingsLayout.js';
import { PersonalPage } from './pages/settings/PersonalPage.js';
import { ContactInfoPage } from './pages/settings/ContactInfoPage.js';
import { TeamPage } from './pages/admin/TeamPage.js';
import { BrandingPage } from './pages/admin/BrandingPage.js';
import { ClientsPage } from './pages/admin/ClientsPage.js';
import { BillingPage } from './pages/admin/BillingPage.js';
import { CapiroAdminPage } from './pages/capiro-admin/CapiroAdminPage.js';
import { ClientWorkspacePage } from './pages/clients/ClientWorkspacePage.js';
import { DirectoryPage } from './pages/directory/DirectoryPage.js';
import { HelpPage } from './pages/help/HelpPage.js';
import { HomePage } from './pages/HomePage.js';
import { EngagementPage } from './pages/engagement/EngagementPage.js';
import { IntegrationsPage } from './pages/settings/IntegrationsPage.js';
import { AiUsagePage } from './pages/settings/AiUsagePage.js';
import { WorkspaceLayout } from './pages/workspace/WorkspaceLayout.js';
import { CatalogView } from './pages/workspace/CatalogView.js';
import { WorkflowsView } from './pages/workspace/WorkflowsView.js';
import { WorkspaceOverview } from './pages/workspace/WorkspaceOverview.js';
import { StrategiesList } from './pages/workspace/StrategiesList.js';
import { StrategyWizard } from './pages/workspace/StrategyWizard.js';
import { StrategyDashboard } from './pages/workspace/StrategyDashboard.js';
import { WhitePaperEditorPage } from './pages/workspace/WhitePaperEditorPage.js';
import { ComingSoonIntelligence } from './pages/intelligence/ComingSoonIntelligence.js';
import { ChangesInboxPage } from './pages/intelligence/ChangesInboxPage.js';
import { IntelligenceMappingsPage } from './pages/settings/IntelligenceMappingsPage.js';
import { SkillsPage } from './pages/settings/SkillsPage.js';
import { IssueLeaderboardPage } from './pages/intelligence/IssueLeaderboardPage.js';
import { DataExplorerPage } from './pages/explorer/DataExplorerPage.js';
import { ActionBoardPage } from './pages/actions/ActionBoardPage.js';

const ProgramElementWatchPage = lazy(async () =>
  import('./pages/program-element/ProgramElementWatchPage.js').then((m) => ({
    default: m.ProgramElementWatchPage,
  })),
);

const MarkupMonitorPage = lazy(async () =>
  import('./pages/program-element/MarkupMonitorPage.js').then((m) => ({
    default: m.MarkupMonitorPage,
  })),
);

const ProgramElementFinderPage = lazy(async () =>
  import('./pages/program-element/ProgramElementFinderPage.js').then((m) => ({
    default: m.ProgramElementFinderPage,
  })),
);

const PersonCandidatesPage = lazy(async () =>
  import('./pages/program-element/PersonCandidatesPage.js').then((m) => ({
    default: m.PersonCandidatesPage,
  })),
);

const PeReconciliationPage = lazy(async () =>
  import('./pages/admin/PeReconciliationPage.js').then((m) => ({
    default: m.PeReconciliationPage,
  })),
);

const ProgramMatchQueuePage = lazy(async () =>
  import('./pages/program-element/ProgramMatchQueuePage.js').then((m) => ({
    default: m.ProgramMatchQueuePage,
  })),
);

const AnalystConsolePage = lazy(async () =>
  import('./pages/admin/AnalystConsolePage.js').then((m) => ({
    default: m.AnalystConsolePage,
  })),
);

export function App() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    if (import.meta.env.DEV) {
      const waitInfo = config.clerkPublishableKey.startsWith('pk_test_')
        ? `Waiting for Clerk session on ${config.clerkPublishableKey.split('_').at(-1) ?? 'unknown'}`
        : 'Waiting for Clerk session...';
      return <PlaceholderPage title="Loading" description={waitInfo} />;
    }
    return <PlaceholderPage title="Loading" description="Please wait..." />;
  }

  return (
    <Routes>
      <Route path="/sign-in/*" element={<AuthPage mode="sign-in" />} />
      <Route path="/sign-up/*" element={<AuthPage mode="sign-up" />} />
      <Route
        element={
          isSignedIn ? (
            <AppShell />
          ) : (
            <Navigate to="/sign-in" replace />
          )
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/clients" element={<ClientWorkspacePage />} />
        <Route path="/engagement/*" element={<EngagementPage />} />
        <Route path="/workspace" element={<WorkspaceLayout />}>
          <Route index element={<Navigate to="/workspace/overview" replace />} />
          <Route path="overview" element={<WorkspaceOverview />} />
          <Route path="library" element={<CatalogView />} />
          <Route path="workflows" element={<WorkflowsView />} />
          <Route path="strategies" element={<StrategiesList />} />
          <Route path="strategy/new" element={<StrategyWizard />} />
          <Route path="strategy/:id" element={<StrategyDashboard />} />
          <Route path="strategy/:id/white-paper/:instanceId" element={<WhitePaperEditorPage />} />
          <Route path="catalog" element={<Navigate to="/workspace/library" replace />} />
          <Route path="kanban" element={<Navigate to="/workspace/workflows" replace />} />
        </Route>
        <Route path="/explorer" element={<DataExplorerPage />} />
        <Route path="/actions" element={<ActionBoardPage />} />
        <Route
          path="/program-elements"
          element={
            <Suspense fallback={<PlaceholderPage title="Loading program elements" description="Please wait..." />}>
              <ProgramElementFinderPage />
            </Suspense>
          }
        />
        {/* Static segment must precede the dynamic :peCode route. */}
        <Route
          path="/program-elements/mark-up-monitor"
          element={
            <Suspense fallback={<PlaceholderPage title="Loading mark-up monitor" description="Please wait..." />}>
              <MarkupMonitorPage />
            </Suspense>
          }
        />
        <Route
          path="/program-elements/contacts"
          element={
            <Suspense fallback={<PlaceholderPage title="Loading contacts" description="Please wait..." />}>
              <PersonCandidatesPage />
            </Suspense>
          }
        />
        <Route
          path="/program-elements/:peCode"
          element={
            <Suspense fallback={<PlaceholderPage title="Loading program element" description="Please wait..." />}>
              <ProgramElementWatchPage />
            </Suspense>
          }
        />
        <Route
          path="/admin/program-element/reconciliation"
          element={
            <Suspense fallback={<PlaceholderPage title="Loading reconciliation queue" description="Please wait..." />}>
              <PeReconciliationPage />
            </Suspense>
          }
        />
        <Route
          path="/admin/program-element/match-queue"
          element={
            <Suspense fallback={<PlaceholderPage title="Loading program match queue" description="Please wait..." />}>
              <ProgramMatchQueuePage />
            </Suspense>
          }
        />
        {/* Step 3.5 — Unified analyst console (capiro_admin). Gated client-side by
            the page itself; every endpoint it calls enforces RolesGuard server-side.
            Must precede the /admin/* catch-all redirect below. */}
        <Route
          path="/admin/analyst-console"
          element={
            <Suspense fallback={<PlaceholderPage title="Loading analyst console" description="Please wait..." />}>
              <AnalystConsolePage />
            </Suspense>
          }
        />
        {/* Intelligence routes kept for legacy URLs, the page renames itself
            to "Intelligence Center" in the sidebar, but ChangesInbox + IssueLeaderboard
            stay reachable for now. The main /intelligence path redirects. */}
        <Route path="/intelligence" element={<Navigate to="/explorer" replace />} />
        <Route path="/intelligence/changes" element={<ChangesInboxPage />} />
        <Route path="/intelligence/issues/:code" element={<IssueLeaderboardPage />} />
        <Route path="/intelligence/bills/:bill" element={<BillDetailRedirectRoute />} />
        <Route path="/intelligence/client/:clientId" element={<Navigate to="/clients" replace />} />
        <Route path="/intelligence/client/:clientId/graph" element={<Navigate to="/clients" replace />} />
        <Route path="/intelligence/*" element={<Navigate to="/explorer" replace />} />
        <Route path="/intelligence-center" element={<ComingSoonIntelligence />} />
        <Route path="/directory" element={<DirectoryPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/portal/*" element={<Navigate to="/clients" replace />} />

        {/* Settings hosts personal + admin + capiro-admin tabs. Tabs are
            role-filtered in SettingsLayout; the API enforces RolesGuard
            on every endpoint as the security boundary. */}
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="/settings/personal" replace />} />
          <Route path="personal" element={<PersonalPage />} />
          <Route path="contact" element={<ContactInfoPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="branding" element={<BrandingPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="ai-usage" element={<AiUsagePage />} />
          <Route path="intelligence-mappings" element={<IntelligenceMappingsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="tenants" element={<CapiroAdminPage />} />
        </Route>

        {/* Back-compat: old /admin/* and /capiro-admin URLs redirect into Settings. */}
        <Route path="/admin" element={<Navigate to="/settings/team" replace />} />
        <Route path="/admin/*" element={<Navigate to="/settings/team" replace />} />
        <Route path="/capiro-admin" element={<Navigate to="/settings/tenants" replace />} />

        <Route
          path="*"
          element={
            <PlaceholderPage title="Not found" description="404 - this page doesn't exist." />
          }
        />
      </Route>
    </Routes>
  );
}

function BillDetailRedirectRoute() {
  const { bill } = useParams<{ bill: string }>();
  const encodedBill = bill ? encodeURIComponent(bill) : '';
  const target = encodedBill ? `/explorer?bill=${encodedBill}` : '/explorer';
  return <Navigate to={target} replace />;
}

function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  return (
    <main className="auth-page">
      <section className="auth-shell" aria-label={mode === 'sign-in' ? 'Sign in' : 'Sign up'}>
        <img src="/logo.png" alt="Capiro" className="auth-logo" />
        <div className="auth-clerk-frame">
          {mode === 'sign-in' ? (
            <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
          ) : (
            <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
          )}
        </div>
      </section>
    </main>
  );
}
