import { Navigate, Route, Routes } from 'react-router-dom';
import { RedirectToSignIn, SignIn, SignedIn, SignedOut } from '@clerk/clerk-react';
import { AppShell } from './components/AppShell.js';
import { HomePage } from './pages/HomePage.js';
import { PlaceholderPage } from './pages/PlaceholderPage.js';
import { AdminLayout } from './pages/admin/AdminLayout.js';
import { TeamPage } from './pages/admin/TeamPage.js';
import { BrandingPage } from './pages/admin/BrandingPage.js';
import { ClientsPage } from './pages/admin/ClientsPage.js';
import { BillingPage } from './pages/admin/BillingPage.js';
import { CapiroAdminPage } from './pages/capiro-admin/CapiroAdminPage.js';

export function App() {
  return (
    <Routes>
      <Route
        path="/sign-in/*"
        element={<SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />}
      />
      <Route
        path="/sign-up/*"
        element={<SignIn routing="path" path="/sign-up" />}
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
        <Route
          path="/clients"
          element={<PlaceholderPage title="Clients" description="Per-client view of activity. Adds detail tabs in the next session." />}
        />
        <Route
          path="/engagement"
          element={<PlaceholderPage title="Engagement Manager" description="Cross-client engagement workbench — calendars, meetings, outreach." />}
        />
        <Route path="/workspace" element={<PlaceholderPage title="Workspace" />} />
        <Route path="/hub" element={<PlaceholderPage title="Intelligence Hub" />} />
        <Route
          path="/directory"
          element={<PlaceholderPage title="Directory" description="Members, staffers, offices. Faceted search comes in a later session." />}
        />
        <Route path="/portal" element={<PlaceholderPage title="Client Portal" />} />
        <Route
          path="/settings"
          element={<PlaceholderPage title="Settings" description="Personal settings. Tenant-level controls live under Admin Panel." />}
        />

        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="/admin/team" replace />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="branding" element={<BrandingPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="billing" element={<BillingPage />} />
        </Route>

        <Route path="/capiro-admin" element={<CapiroAdminPage />} />

        <Route path="*" element={<PlaceholderPage title="Not found" description="404 — this page doesn't exist." />} />
      </Route>
    </Routes>
  );
}
