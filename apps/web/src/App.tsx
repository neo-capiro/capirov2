import { Navigate, Route, Routes } from 'react-router-dom';
import { RedirectToSignIn, SignIn, SignedIn, SignedOut, SignUp } from '@clerk/clerk-react';
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
import { HomePage } from './pages/HomePage.js';
import { EngagementPage } from './pages/engagement/EngagementPage.js';
import { IntegrationsPage } from './pages/settings/IntegrationsPage.js';
import { WorkspaceLayout } from './pages/workspace/WorkspaceLayout.js';
import { CatalogView } from './pages/workspace/CatalogView.js';
import { KanbanBoard } from './pages/workspace/KanbanBoard.js';
import { StrategiesList } from './pages/workspace/StrategiesList.js';
import { StrategyWizard } from './pages/workspace/StrategyWizard.js';
import { StrategyDashboard } from './pages/workspace/StrategyDashboard.js';
import { IntelligenceCenterPage } from './pages/intelligence/IntelligenceCenterPage.js';
import { ChangesInboxPage } from './pages/intelligence/ChangesInboxPage.js';
import { IntelligenceMappingsPage } from './pages/settings/IntelligenceMappingsPage.js';
import { IssueLeaderboardPage } from './pages/intelligence/IssueLeaderboardPage.js';

export function App() {
  return (
    <Routes>
      <Route path="/sign-in/*" element={<AuthPage mode="sign-in" />} />
      <Route path="/sign-up/*" element={<AuthPage mode="sign-up" />} />
      <Route
        element={
          <>
            <SignedIn>
              <AppShell />
            </SignedIn>
            <SignedOut>
              <RedirectToSignIn />
            </SignedOut>
          </>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/clients" element={<ClientWorkspacePage />} />
        <Route path="/engagement" element={<EngagementPage />} />
        <Route path="/workspace" element={<WorkspaceLayout />}>
          <Route index element={<Navigate to="/workspace/catalog" replace />} />
          <Route path="catalog" element={<CatalogView />} />
          <Route path="kanban" element={<KanbanBoard />} />
          <Route path="strategies" element={<StrategiesList />} />
          <Route path="strategy/new" element={<StrategyWizard />} />
          <Route path="strategy/:id" element={<StrategyDashboard />} />
        </Route>
        <Route path="/intelligence" element={<IntelligenceCenterPage />} />
        <Route path="/intelligence/changes" element={<ChangesInboxPage />} />
        <Route path="/intelligence/issues/:code" element={<IssueLeaderboardPage />} />
        <Route path="/intelligence/client/:clientId" element={<Navigate to="/clients" replace />} />
        <Route path="/intelligence/client/:clientId/graph" element={<Navigate to="/clients" replace />} />
        <Route path="/intelligence/*" element={<Navigate to="/intelligence" replace />} />
        <Route path="/directory" element={<DirectoryPage />} />
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
          <Route path="intelligence-mappings" element={<IntelligenceMappingsPage />} />
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
