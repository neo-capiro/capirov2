# Fresh Tenant Onboarding — End-to-End Runbook

> Status: 2026-06-07. Reflects the onboarding fixes shipped in PRs #51–#54
> (invite-on-create + names, the 403/500 regressions, Clerk v2 claim
> normalization, webhook name capture, and the Outlook account/consent UX).

Account 967807252336 · Region us-east-1 · Cluster `capiro-dev` (serves app.capiro.ai)
Identity: **Clerk** (orgs = tenants). Email/calendar: **Microsoft Graph** (delegated, per-user).

This is the happy path for standing up a brand-new customer firm and getting
their first admin signed in with Outlook connected. Steps 1–3 are fully
self-serve from Capiro. Step 4(a) — Microsoft org consent — is the ONE step that
requires the customer's own Microsoft admin and cannot be done by Capiro.

================================================================
## 1. Create the tenant  (Capiro staff, capiro_admin)
================================================================
Capiro Admin → **Tenants** → **Create tenant**. Fields:
- **slug** — lowercase `[a-z0-9-]`, 2–63 chars, no leading hyphen (becomes the
  subdomain label, e.g. `acme-lobbying`).
- **display name** — e.g. "Acme Lobbying Group".
- **admin first name / admin last name** — carried through to sign-up + stored.
- **admin email** — the firm's first user_admin.

What happens server-side (`POST /api/capiro-admin/tenants` →
`CapiroAdminService.createTenantWithFirstAdmin`):
- Creates/links the Clerk **organization** + the DB **tenant** row.
- Sends a real **Clerk organization invitation** email to the admin
  (redirect → `/sign-up`), with first/last name in the invitation
  `public_metadata`.
- Creates NOTHING else locally — the `users` row is created on accept (see §2).
  (Pre-creating a placeholder `users` row with a fake clerkUserId is a known
  500-causing anti-pattern; do not reintroduce it.)

Success toast: "Tenant created. Invitation email sent to <admin email>."

================================================================
## 2. First admin onboards  (the customer)
================================================================
1. Admin opens the invite email → lands on `/sign-up` (NOT /sign-in — new
   users have no account; the invite ticket is claimed by SignUp).
2. Sets a password, completes sign-up.
3. Clerk fires webhooks → our Svix endpoint (`https://app.capiro.ai/webhooks/clerk`):
   `user.created`, `organizationInvitation.accepted`,
   `organizationMembership.created`. The webhook creates the `users` row with
   the REAL clerkUserId and the name (read from the membership's
   `public_metadata` — the invitee usually doesn't type a name into Clerk's
   form, so the invitation metadata is the authoritative name source).
4. Admin signs in → profile loads (200), correct tenant shows in the banner.

If the webhook is delayed, the tenant-context middleware **self-heals**: on the
first authenticated request it creates/adopts the `users` row from the verified
JWT and provisions the active membership from the `org_id` claim. So login
works even if a webhook is late.

PREREQUISITE — the Clerk webhook endpoint must be **Enabled** in Svix
(Clerk dashboard → Configure → Webhooks). If it's Disabled (Svix auto-disables
after a sustained error rate), onboarding limps on self-heal only and names/
status can lag. See `skills/.../references/clerk-webhook-svix-debugging.md`.

================================================================
## 3. Admin invites their team  (the customer)
================================================================
Settings → **Team** → **Add team member** → first name, last name, email, role
(`user_admin` | `standard_user`) → sends a Clerk invitation. Each teammate
accepts exactly like §2. Names render in the team list immediately on accept.

================================================================
## 4. Connect Outlook (Microsoft 365)  — has a one-time prerequisite
================================================================
Model: **delegated, per-user**. Each user connects THEIR OWN mailbox. Scopes:
`offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send Calendars.Read`.
Multi-tenant app (authority `/organizations`). App (client) ID:
`5dba7b19-929d-40d0-bf63-0f9143b3734f`. Registered redirect:
`https://app.capiro.ai/api/engagement/integrations/microsoft/callback`.

### 4(a) ONE-TIME: customer's Microsoft global admin grants org-wide consent
A brand-new customer Microsoft (Entra) tenant almost always has "users can
consent to apps" disabled, so the FIRST connect hits an admin-consent wall and
every user keeps getting "enter an admin account" until consent is granted
ORG-WIDE. **Only the customer's M365 global admin can do this, in their own
tenant. Capiro cannot grant it.** Two ways:

- Entra admin center (surest, no redirect): entra.microsoft.com →
  Enterprise applications → search the Capiro app (App ID above) → Security →
  Permissions → **"Grant admin consent for <org>"** → confirm.
- Admin-consent URL (admin signs in, clicks Accept):
  `https://login.microsoftonline.com/<CUSTOMER_DOMAIN>/adminconsent?client_id=5dba7b19-929d-40d0-bf63-0f9143b3734f&redirect_uri=https://app.capiro.ai/api/engagement/integrations/microsoft/callback`
  (the callback now lands gracefully on the integrations page; no 400).

### 4(b) Each user connects their own mailbox
Settings → Integrations → **Connect Microsoft** → on the Microsoft picker click
**"Use another account"** and choose THEIR OWN account. (The flow uses
`prompt=select_account` so the picker always shows — this prevents silently
binding whatever MS account the browser is already signed into, which is how
the wrong/admin mailbox got bound previously.)

After connect: the connection row stores `accountEmail` = whoever completed
OAuth. Calendar + mail sync begins; a background poller refreshes on a ~7-min
cadence. Verify a connection is bound to the RIGHT mailbox:
`accountEmail` should equal the connecting user's own address.

### Outlook gotchas
- Wrong mailbox bound (e.g. an admin/service account)? Delete that
  `integration_connection` row (cascades its token) and have the user reconnect
  with "Use another account".
- `redirect_uri` must match the registered reply URL exactly (`app.capiro.ai`,
  `/api/...` prefix). Mismatch → AADSTS error on callback.

================================================================
## 5. Verify (Neo's bar — end-to-end, not just "API 200")
================================================================
- `/api/me` returns 200 for the new user with the correct `tenant` + name.
- No `ExceptionsHandler` / `PrismaClientKnownRequestError` / 403 in
  `/capiro/dev/api` for that user.
- Team list shows the member by name (not raw email).
- Outlook: connection `status=connected`, `accountEmail` = the user's own
  mailbox, and mail/meeting counts for the tenant start climbing.

================================================================
## Reset / start over (test tenants)
================================================================
1. Settings → delete the tenant (cascades all tenant-scoped DB rows + best-effort
   Clerk org delete).
2. The standalone Clerk **user** survives a tenant delete — if reusing the same
   email, delete the Clerk user too (Clerk dashboard or Backend API) or you'll
   hit "email address already exists". Easiest: use a fresh email per test.
3. Recreate from §1.
