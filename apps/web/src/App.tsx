import { Navigate, Route, Routes } from 'react-router-dom';
import { RedirectToSignIn, SignIn, SignedIn, SignedOut, SignUp } from '@clerk/clerk-react';
import { AppShell } from './components/AppShell.js';
import { HomePage } from './pages/HomePage.js';
import { PlaceholderPage } from './pages/PlaceholderPage.js';
import { SettingsLayout } from './pages/settings/SettingsLayout.js';
import { PersonalPage } from './pages/settings/PersonalPage.js';
import { TeamPage } from './pages/admin/TeamPage.js';
import { BrandingPage } from './pages/admin/BrandingPage.js';
import { ClientsPage } from './pages/admin/ClientsPage.js';
import { BillingPage } from './pages/admin/BillingPage.js';
import { CapiroAdminPage } from './pages/capiro-admin/CapiroAdminPage.js';
import { ClientWorkspacePage } from './pages/clients/ClientWorkspacePage.js';
import { DirectoryPage } from './pages/directory/DirectoryPage.js';
import { EngagementPage } from './pages/engagement/EngagementPage.js';
import { IntegrationsPage } from './pages/settings/IntegrationsPage.js';

export function App() {
  return (
    <Routes>
      <Route
        path="/sign-in/*"
        element={
          <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
        }
      />
      <Route
        path="/sign-up/*"
        element={
          <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
        }
      />
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
        <Route path="/workspace" element={<PlaceholderPage title="Workspace" />} />
        <Route path="/intelligence" element={<PlaceholderPage title="Intelligence" />} />
        <Route path="/directory" element={<DirectoryPage />} />
        <Route path="/portal" element={<PlaceholderPage title="Client Portal" />} />

        {/* Settings hosts personal + admin + capiro-admin tabs. Tabs are
            role-filtered in SettingsLayout; the API enforces RolesGuard
            on every endpoint as the security boundary. */}
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="/settings/personal" replace />} />
          <Route path="personal" element={<PersonalPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="branding" element={<BrandingPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="billing" element={<BillingPage />} />
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
