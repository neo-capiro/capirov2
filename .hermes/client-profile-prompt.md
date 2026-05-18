TASK: Redesign the Clients tab to match the v1 mockup design. This is a major UI overhaul of the client profile page.

## CONTEXT — READ THESE FILES FIRST:
- C:\Users\neoma\Downloads\capiro_v1.html (the mockup — read lines 4901-5500 for the client profile HTML structure, lines 1128-1300 for CSS)
- apps/web/src/pages/clients/ClientWorkspacePage.tsx (current clients page)
- apps/web/src/pages/clients/ClientFormModal.tsx (current client form)
- apps/web/src/pages/clients/clientTypes.ts (client type definitions)
- apps/web/src/components/AppShell.tsx (navigation context)
- apps/web/src/theme.css (existing styles — match these CSS variables)
- apps/web/src/lib/use-api.ts (API client)

## DESIGN SPECIFICATIONS

The mockup at capiro_v1.html shows a client profile page with a navy banner, tabs, and rich content sections. Replicate this design but:
- DO NOT include: Tasks tab, Work Products tab, Intelligence tab, Knowledge Base tab, Opportunities tab
- DO NOT include: the "Clio health banner" (the blue banner in overview that says "Jaia Robotics is on track...")
- DO include: Overview tab, Capabilities tab, People tab, Workflows tab

### Page Structure:

When a user clicks on a client card in the list view, it opens the CLIENT PROFILE PAGE:

1. **Banner Header** (navy/dark background):
   - Back button (arrow left, returns to client list)
   - Client logo (initials or image)
   - Client name (large, white)
   - Meta line: website link, POC name, POC email
   - Tags (from intakeData: sector, portfolio, etc.)
   - Action buttons: "Edit" and "+ New Workflow"

2. **Tab Navigation** (below banner):
   - Overview (default)
   - Capabilities
   - People
   - Workflows

3. **Tab Content Area**:

#### OVERVIEW TAB:
Two-column layout (main content left, sidebar right).

LEFT COLUMN:
- **Company Information** section (card):
  - Legal name, Website, Description, Sector, Product Description
  - Pull from existing Client model fields
- **Government Registration** section (card):
  - CAGE Code, UEI (SAM), Primary NAICS, SAM Status, Existing contracts
  - Pull from intakeData fields — users fill these in the client profile
- **Engagement Info** section (card):
  - Status (active/inactive)
  - Created date
  - Any engagement summary data available

RIGHT COLUMN:
- **Capabilities** summary (top 3 capabilities from intakeData, with "View all" link to Capabilities tab)
  - Show capability name, type tag, TRL, and funding ask amount
  - "+ Add capability" button

#### CAPABILITIES TAB:
Full-width list of capabilities (products, services, technologies).
- Each capability card shows: name, type (Product/Service/Platform), tags, description, TRL/MRL, funding ask
- "+ Add capability" button
- Clicking a capability opens a **detail drawer** from the right side with:
  - Profile panel: readiness matrix (TRL/MRL bars), description, government engagement fields (PE, account, service, subcommittee, funding ask, justification), district nexus
  - Submission History panel: timeline of past FY submissions with outcomes
  - Documents panel: file upload zone + document list

NOTE: Capabilities are stored in client intakeData as an array. Add a `capabilities` array to the ClientIntakeData type:
```typescript
interface Capability {
  id: string;
  name: string;
  type: 'product' | 'service' | 'platform' | 'technology';
  description?: string;
  sector?: string;
  tags?: string[];
  trl?: number;
  mrl?: number;
  peNumber?: string;
  appropriationAccount?: string;
  service?: string;
  targetSubcommittee?: string;
  fundingAsk?: number;
  fundingAskLabel?: string;
  justification?: string;
  districtNexus?: string;
  existingContracts?: string;
  submissionHistory?: SubmissionHistoryEntry[];
  notes?: string;
}
interface SubmissionHistoryEntry {
  fy: string;
  title: string;
  meta: string;
  outcome: string;
  outcomeType: 'success' | 'partial' | 'failed' | 'in_progress';
  notes?: string;
}
```

#### PEOPLE TAB:
Grid of contact cards for people associated with this client.
- Each card: avatar (initials), name, title, email, phone, role tag (Primary POC / Executive / BD), last contact date
- "+ Add person" button
- People stored in intakeData as a `people` array:
```typescript
interface ClientPerson {
  id: string;
  name: string;
  title: string;
  email?: string;
  phone?: string;
  role?: string;
  lastContact?: string;
}
```

#### WORKFLOWS TAB:
List of workflow instances associated with this client.
- Fetch from GET /api/workflows/instances?clientId=...
- Each row shows: type badge (NDAA/APPR/etc), name, meta (status, created, owner), status chip
- Clicking opens the workflow drawer (already built)

### CSS — Match the mockup styling within existing Capiro design:

The mockup uses these CSS variables which map to existing Capiro theme vars:
- --navy (#0F1F3D) → use existing --ink-900 or hardcode the navy
- --accent (#1B4FD8) → use existing blue accent
- --sw (#F5F7FA) → use existing --app-bg-1
- --bd (#E4E8F0) → use existing --line-soft

Add all new CSS at the END of theme.css. Use class prefixes:
- .cp-* for client profile components
- .cap-* for capability components
- .overview-* for overview layout

### Implementation approach:

Create these new files:
- `apps/web/src/pages/clients/ClientProfilePage.tsx` — the full profile page
- `apps/web/src/pages/clients/CapabilityDrawer.tsx` — the right-side capability detail drawer

Modify these files:
- `apps/web/src/pages/clients/ClientWorkspacePage.tsx` — add state to toggle between list view and profile view when a client is clicked
- `apps/web/src/pages/clients/clientTypes.ts` — add Capability, ClientPerson, SubmissionHistoryEntry types
- `apps/web/src/theme.css` — add all new styles

DO NOT modify App.tsx routing — the clients page stays at /clients. The profile view is rendered within ClientWorkspacePage based on state (selectedClientId).

### Data approach:
- Company info comes from Client model fields (name, website, description, productDescription)
- Government registration, capabilities, and people come from intakeData JSON
- Workflows come from the existing workflows API filtered by clientId
- The capability drawer is local state — data lives in intakeData

This is a FRONTEND-ONLY change. No API changes needed. All data goes in/out of the existing Client model's intakeData JSON field and the existing fields.
