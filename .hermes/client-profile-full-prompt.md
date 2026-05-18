TASK: Redesign the Clients tab with a rich profile page + backend models. This needs FULL functionality — not just UI.

## CONTEXT — READ THESE FILES FIRST:
- C:\Users\neoma\Downloads\capiro_v1.html (lines 4901-5500 for profile HTML, lines 1128-1300 for CSS)
- apps/web/src/pages/clients/ClientWorkspacePage.tsx (current clients page)
- apps/web/src/pages/clients/ClientFormModal.tsx (current client form)
- apps/web/src/pages/clients/clientTypes.ts (client types)
- apps/api/prisma/schema.prisma (current schema — read ALL of it)
- apps/api/src/clients/clients.module.ts (clients module)
- apps/api/src/app.module.ts (module registration)
- apps/web/src/theme.css (existing styles)
- apps/web/src/lib/use-api.ts (API client)

## PART 1: DATABASE — New Prisma Models

Add these models to the END of schema.prisma. Follow the exact conventions (tenant_id, uuid, @@map snake_case, timestamps with Timestamptz(6), JSON as @map("foo_jsonb")).

### ClientCapability
Stores products/services/technologies for a client — the core of what lobbyists represent.
```
model ClientCapability {
  id                   String   @id @default(uuid()) @db.Uuid
  tenantId             String   @map("tenant_id") @db.Uuid
  clientId             String   @map("client_id") @db.Uuid
  name                 String
  type                 String   @default("product") // product, service, platform, technology
  description          String?  @db.Text
  sector               String?
  tags                 Json     @default("[]") @map("tags_jsonb")
  trl                  Int?
  mrl                  Int?
  peNumber             String?  @map("pe_number")
  appropriationAccount String?  @map("appropriation_account")
  serviceBranch        String?  @map("service_branch")
  targetSubcommittee   String?  @map("target_subcommittee")
  fundingAsk           Int?     @map("funding_ask")
  fundingAskLabel      String?  @map("funding_ask_label")
  justification        String?  @db.Text
  districtNexus        String?  @map("district_nexus") @db.Text
  existingContracts    String?  @map("existing_contracts")
  notes                String?  @db.Text
  sortOrder            Int      @default(0) @map("sort_order")
  createdAt            DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant              Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  client              Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  submissionHistory   ClientSubmissionHistory[]

  @@index([tenantId, clientId], map: "client_capabilities_tenant_client_idx")
  @@map("client_capabilities")
}
```

### ClientSubmissionHistory
Tracks FY-by-FY submission history per capability.
```
model ClientSubmissionHistory {
  id             String   @id @default(uuid()) @db.Uuid
  tenantId       String   @map("tenant_id") @db.Uuid
  clientId       String   @map("client_id") @db.Uuid
  capabilityId   String?  @map("capability_id") @db.Uuid
  fiscalYear     String   @map("fiscal_year") // e.g. "FY27"
  title          String
  meta           String?
  outcome        String?
  outcomeType    String   @default("in_progress") @map("outcome_type") // success, partial, failed, in_progress
  notes          String?  @db.Text
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant     Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  client     Client              @relation(fields: [clientId], references: [id], onDelete: Cascade)
  capability ClientCapability?   @relation(fields: [capabilityId], references: [id], onDelete: SetNull)

  @@index([tenantId, clientId, capabilityId], map: "client_submission_history_tenant_client_cap_idx")
  @@map("client_submission_history")
}
```

### ClientPerson
Contacts/people at the client organization.
```
model ClientPerson {
  id          String   @id @default(uuid()) @db.Uuid
  tenantId    String   @map("tenant_id") @db.Uuid
  clientId    String   @map("client_id") @db.Uuid
  name        String
  title       String?
  email       String?  @db.Citext
  phone       String?
  role        String?  // "Primary POC", "Executive", "BD", "Technical", etc.
  lastContact DateTime? @map("last_contact") @db.Timestamptz(6)
  notes       String?  @db.Text
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  client Client @relation(fields: [clientId], references: [id], onDelete: Cascade)

  @@index([tenantId, clientId], map: "client_people_tenant_client_idx")
  @@map("client_people")
}
```

Also add relation arrays to the existing models:
- Tenant: add `clientCapabilities ClientCapability[]`, `clientSubmissionHistory ClientSubmissionHistory[]`, `clientPeople ClientPerson[]`
- Client: add `capabilities ClientCapability[]`, `submissionHistory ClientSubmissionHistory[]`, `people ClientPerson[]`

### Migration
Create migration with --create-only:
```
cd apps/api && npx prisma migrate dev --name add-client-capabilities-people --create-only
```

## PART 2: API ENDPOINTS

Add to the existing clients controller (apps/api/src/clients/) or create new sub-controllers. Read the existing controller pattern first.

### Capabilities CRUD:
- GET /api/clients/:clientId/capabilities — list capabilities
- POST /api/clients/:clientId/capabilities — create
- PATCH /api/clients/:clientId/capabilities/:id — update
- DELETE /api/clients/:clientId/capabilities/:id — delete

### People CRUD:
- GET /api/clients/:clientId/people — list people
- POST /api/clients/:clientId/people — create
- PATCH /api/clients/:clientId/people/:id — update
- DELETE /api/clients/:clientId/people/:id — delete

### Submission History CRUD:
- GET /api/clients/:clientId/capabilities/:capId/history — list
- POST /api/clients/:clientId/capabilities/:capId/history — create
- PATCH /api/clients/:clientId/history/:id — update
- DELETE /api/clients/:clientId/history/:id — delete

All endpoints must be tenant-scoped. Follow the exact auth pattern from the workflows controller (RolesGuard, @CurrentTenant, TenantContext).

## PART 3: FRONTEND — Client Profile Page

### New Files:
- `apps/web/src/pages/clients/ClientProfilePage.tsx` — full profile page
- `apps/web/src/pages/clients/CapabilityDrawer.tsx` — right-side capability detail drawer

### ClientProfilePage.tsx structure:

1. **Banner Header** (dark navy background #1C2E4A):
   - Back button → returns to client list
   - Client logo (initials or image, 52px rounded)
   - Client name (20px, white, bold)
   - Meta: website link (blue), POC name, POC email
   - Tags from intakeData (sector, portfolio items)
   - Action buttons: "Edit" (opens ClientFormModal), "+ New Workflow" (navigates to /workspace/catalog)

2. **Tab Navigation**:
   - Overview, Capabilities, People, Workflows
   - Use same tab styling pattern as the mockup

3. **Overview Tab** (two-column grid: 1fr 340px):
   LEFT:
   - Company Information card: name, website, description, sector, productDescription
   - Government Registration card: intakeData fields (cageCode, uei, primaryNaics, samStatus, existingContracts) — these are optional, show "Not provided" if empty
   - Engagement Info card: status, createdAt date

   RIGHT:
   - Capabilities summary (top 3 from API), each showing name, type tag, TRL, funding ask
   - "View all" link to Capabilities tab
   - "+ Add capability" button

4. **Capabilities Tab**:
   - Full list from GET /api/clients/:id/capabilities
   - Each card: name, type tag, sector tags, description (truncated), TRL/MRL, funding ask
   - Click → opens CapabilityDrawer
   - "+ Add capability" button → opens a create form (inline or modal)

5. **People Tab**:
   - Grid (3 columns) from GET /api/clients/:id/people
   - Each card: avatar (initials), name, title, email, phone, role chip, last contact
   - "+ Add person" button

6. **Workflows Tab**:
   - List from GET /api/workflows/instances?clientId=X
   - Each row: type badge, name, meta, status chip
   - Reuse existing workflow data

### CapabilityDrawer.tsx:
Right-side drawer (560px wide) with 3 sub-tabs:
- **Profile**: readiness matrix (TRL/MRL bars), description, government engagement fields (PE, account, service, subcommittee, funding ask, justification), district nexus, notes
- **Submission History**: timeline from GET /api/clients/:clientId/capabilities/:capId/history, add entry button
- **Documents**: client attachments filtered to this capability (future — for now show a placeholder)

All fields in the drawer should be EDITABLE inline — use contentEditable or Input fields that save on blur via PATCH.

### Modify ClientWorkspacePage.tsx:
Add state: `selectedClientId`. When a client card is clicked, set it. When set, render ClientProfilePage instead of the card grid. Back button clears it.

## PART 4: CSS
Add all styles at END of theme.css. Match the mockup exactly — use the CSS from capiro_v1.html lines 1128-1300 as reference but adapt to use existing Capiro CSS variables. Key styles:
- .cp-banner, .cp-back, .cp-logo, .cp-name, .cp-meta, .cp-tag, .cp-actions
- .cp-tabs, .cp-tab
- .overview-grid, .profile-section, .ps-title, .ps-field, .ps-key, .ps-val
- .cap-card, .cap-card-hd, .cap-img, .cap-name, .cap-type-tag, .cap-trl, .cap-ask
- .cap-drawer, .cap-drawer-hd, .cap-drawer-tabs, .cap-drawer-body
- .readiness-matrix, .rm-item, .rm-bar, .rm-bar-fill
- .sub-hist-entry, .she-year, .she-dot, .she-content, .she-title, .she-outcome, .she-notes

## IMPORTANT:
- This must be FULLY FUNCTIONAL — users can create/edit/delete capabilities, people, and submission history
- All data persists to the database via the API
- The profile view must load real data from the API, not hardcoded mockup data
- Follow existing code patterns EXACTLY (useApi, useQuery, useMutation, Ant Design, etc.)
- Do NOT break existing client functionality (create client, edit client, client list, etc.)
