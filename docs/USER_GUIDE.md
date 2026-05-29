# Capiro User Guide (Comprehensive)

Version: 2026-05-25
Audience: Daily users, tenant admins, and Capiro admins
Scope: Entire current web application surface (all active routes + role-gated settings + assistant workflows)

---

## 1) What Capiro is

Capiro is a multi-tenant federal advocacy/lobbying platform combining:
- Intelligence monitoring (regulatory, legislative, contracting, lobbying, campaign finance, etc.)
- Client portfolio management
- Engagement operations (meetings, prep/debrief, outreach, reporting)
- Workflow/strategy execution
- Embedded AI assistant (Clio)

---

## 2) Access, sign-in, and tenancy

### Sign-in
- Use `/sign-in` (or `/sign-up`) via Clerk authentication.
- Unauthenticated users are redirected to sign-in.

### Tenant model
- You always operate inside one tenant.
- Data is tenant-scoped; role controls determine what tabs/actions you can see.

### Roles (practical behavior)
- `standard_user`
  - Core product usage
  - Personal settings
  - Integrations access (personal/provider connection actions)
- `user_admin`
  - Everything above plus Team, Branding, Clients admin, Billing, Intelligence mapping config
- `capiro_admin`
  - Everything above plus Tenants management (cross-tenant admin functions)

---

## 3) Global navigation and shell

Main left nav:
- Dashboard (`/`)
- Engagement (`/engagement`)
- Workspace (`/workspace`)
- Planner (`/planner`), currently disabled
- Intelligence Center (`/explorer`)
- Portfolio (`/clients`)
- Directory (`/directory`)
- Stakeholders, disabled
- Collaborators, disabled

Top shell behaviors:
- Client filter/menu (global context switch)
- Inbox sync triggers for connected Microsoft 365 integration
- Account menu and profile (shows your saved title under name)

Important UX behavior:
- If a workflow lock is active (e.g., outreach process), cross-navigation can be blocked until canceled/completed.

---

## 4) Dashboard (`/`)

Purpose: command center / intelligence inbox experience.

Includes:
- Personalized greeting and “overnight signals” summary
- Recent tracked intelligence changes
- Today timeline (critical/notable events)
- Live ticker stream
- Daily brief
- Coming-up strip (next 7 days)

Data comes from intelligence APIs, filtered to your tenant’s active client portfolio where relevant.

---

## 5) Engagement (`/engagement/*`)

Engagement has four major tabs:
1. Overview
2. Meetings
3. Outreach
4. Reports

### 5.1 Overview
- Summary metrics and action-oriented status cards
- Navigation shortcuts into Meetings/Outreach/Reports

### 5.2 Meetings
- List + calendar modes
- Date-range filtering
- Meeting creation/editing
- Meeting-level detail tabs:
  - Prep
  - Debrief
  - Context
- AI-assisted prep/debrief generation/editing
- Attachment handling
- Notes/debrief confidentiality/access-level support
- Task creation linked to meetings/clients

### 5.3 Outreach
- Wizard-style campaign flow with steps (including recipients, template selection, generation/review, editor, scheduling/send path)
- Intelligence-guided outreach content support
- Campaign and recipient operations

### 5.4 Reports
- Periodized reporting (`current`, `previous`, `all`)
- Status filters and sort controls
- Target-office coverage rows with operational status fields
- Meeting/outreach/submission rollups

### 5.5 Integrations dependency
For full meeting/mail sync behavior, connect Microsoft 365 in Settings → Integrations.

---

## 6) Workspace (`/workspace/*`)

Workspace tabs:
- Overview (`/workspace/overview`)
- Library (`/workspace/library`)
- Workflows (`/workspace/workflows`)
- Strategies (`/workspace/strategies`)

Also supported routes:
- Strategy create wizard: `/workspace/strategy/new`
- Strategy dashboard: `/workspace/strategy/:id`
- White paper editor: `/workspace/strategy/:id/white-paper/:instanceId`

### 6.1 Workspace overview
- Landing summary for active strategy/workflow activity

### 6.2 Library
- Catalog view of available templates/assets

### 6.3 Workflows
- Workflow instances with drawer/editor behavior
- AI assist actions (field enhancement/fill depending template capability)
- Sync-from-strategy operations
- Supporting-doc generation flow where applicable

### 6.4 Strategies
- Strategy list and lifecycle management
- Multi-step strategy wizard
- Strategy dashboard with linked submissions/targets
- Document generation and edit/open actions

### 6.5 Deadlines bar
- Workspace layout surfaces upcoming deadlines (next 14 days), with direct links into strategy dashboards.

---

## 7) Intelligence Center (`/explorer`)

Purpose: deep search/filter/drill-down across intelligence datasets.

Available source tabs:
- LDA Filings
- Federal Contractors
- Congress Bills
- Federal Register
- Hearings
- GAO Reports
- CRS Reports
- FEC Contributions
- FARA Filings
- SEC Filings
- News Feed
- State Bills
- Comment Deadlines

Common interaction model:
- Per-source search input + filters + sort + pagination
- Row click opens a drill-in drawer with record detail

Note:
- Legacy intelligence routes redirect toward `/explorer`.
- Some legacy detail routes remain reachable for compatibility.

---

## 8) Portfolio (`/clients`)

Purpose: client portfolio and profile management.

Core capabilities:
- Client list/cards
- Create/edit/archive/remove flows (role-dependent)
- Client profile views and intake-derived details
- Related intelligence/workflow context surfaces
- Logo upload/presigned upload support

Global client filter in the app shell uses this dataset.

---

## 9) Directory (`/directory`)

Purpose: directory-level contact/entity discovery and lookup.

Used for operational contact workflows and context discovery across people/entities.

---

## 10) Settings (`/settings/*`)

Settings is role-gated and tabbed.

Always visible:
- Personal
- Contact Info
- Integrations

Admin-visible (`user_admin+`):
- Team
- Branding
- Clients
- Billing
- Intelligence

Capiro admin only:
- Tenants

### 10.1 Personal
- Save your profile title (shown in top-right account widget)
- View account metadata (user ID, tenant slug, role)
- Identity details (email/password/MFA) are managed in Clerk

### 10.2 Contact Info
- Personal contact information page

### 10.3 Team (admin)
- View members and invitation state
- Invite users
- Update user role (`standard_user` / `user_admin`)
- Remove members
- Resend pending invitations

### 10.4 Branding (admin)
- Tenant branding settings (name/logo theme surfaces)

### 10.5 Clients (admin)
- Admin-level client configuration controls

### 10.6 Integrations
- Provider records for:
  - Microsoft 365 (fully wired OAuth + sync + realtime subscriptions)
  - Google Workspace (record-level support currently present; OAuth connect button disabled in UI)
  - IMAP/CalDAV (record-level support currently present; OAuth connect button disabled in UI)
- Microsoft-specific actions:
  - Connect OAuth
  - Sync now
  - Configure realtime subscriptions

### 10.7 Billing (admin)
- Tenant billing view/config

### 10.8 Intelligence (admin)
- Intelligence mappings/controls

### 10.9 Tenants (`capiro_admin`)
- Cross-tenant admin operations including tenant management/impersonation functions

---

## 11) Clio assistant (global)

Clio is accessible as a drawer/floating assistant from the shell.

### Capabilities
- Conversation sessions (create/load/switch)
- Session metadata management:
  - Rename session
  - Assign/move session to a client
  - Archive session (soft-delete semantics)
- Context-aware answers and drafting
- Source attributions shown as badges
- Orchestrator telemetry in stream events:
  - Retrieval tier (`fast` / `deep`)
  - Tool trace (selected/skipped + reason)
  - Conflict notices
  - Response templates/structure hints
- Artifact generation and artifact panel:
  - Policy memos, emails, notes, etc.
  - Version/save edits for artifacts

### Session rail
- Browse recent conversations grouped by client context
- Open conversation history
- Archive conversations directly from rail

### Practical tips
- If you need richer retrieval depth, prompt accordingly and inspect source badges/trace output.
- Keep session titles/client links clean for team handoff and governance.

---

## 12) Redirects and legacy paths

Behavior intentionally preserved for compatibility:
- `/intelligence` → `/explorer`
- Older `/portal/*` redirects to `/clients`
- `/admin/*` redirects to `/settings/team`
- `/capiro-admin` redirects to `/settings/tenants`

Some legacy intelligence detail routes still exist for backward compatibility.

---

## 13) What is currently not active

UI entries shown but disabled:
- Planner
- Stakeholders
- Collaborators

Integration connect flows currently disabled in UI:
- Google Workspace OAuth
- IMAP/CalDAV OAuth

(Provider records can still be registered where supported.)

---

## 14) Troubleshooting

### “I can’t see a settings tab”
- Most likely role-gated visibility. Confirm your tenant role.

### “My endpoint returns 401”
- You are not authenticated (or token expired). Re-auth via Clerk.

### “No sync activity in Engagement”
- Check Settings → Integrations:
  - Microsoft 365 must be connected
  - Run “Sync now”
  - Optional: enable realtime subscriptions

### “I switched pages and my client selection reset”
- Client filter is section-sensitive in shell behavior; this is expected when crossing major app sections.

### “Clio session disappeared”
- It may be archived. Check session rail visibility/filtering and client context.

---

## 15) Recommended operating workflow

1) Start on Dashboard for overnight intelligence and urgent items.
2) Move to Engagement for meeting prep/debrief and outreach execution.
3) Use Intelligence Center when you need deep-source evidence.
4) Run strategy/workflow execution in Workspace.
5) Keep Portfolio and Directory data clean.
6) Use Clio for drafting, synthesis, and sessioned operational memory.
7) Tenant admins should routinely manage Team/Integrations/Branding hygiene.

---

## 16) Quick route map

- `/` Dashboard
- `/engagement/*` Engagement
- `/workspace/*` Workspace
- `/explorer` Intelligence Center
- `/clients` Portfolio
- `/directory` Directory
- `/settings/*` Settings
- `/intelligence-center` Legacy/alternate intelligence center page
- `/sign-in/*`, `/sign-up/*` Auth

---

If you want, I can generate a second deliverable: a role-specific runbook set (Standard User / User Admin / Capiro Admin) with day-1 onboarding checklists and SOPs per role.