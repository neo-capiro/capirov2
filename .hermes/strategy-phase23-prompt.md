TASK: Phases 2+3 — Strategy setup wizard + Strategy dashboard (frontend only, API assumed ready).

## CONTEXT — READ FIRST:
- apps/web/src/pages/workspace/WorkspaceLayout.tsx (current workspace tabs)
- apps/web/src/pages/workspace/CatalogView.tsx (current library)
- apps/web/src/pages/workspace/KanbanBoard.tsx (current kanban)
- apps/web/src/pages/workspace/WorkflowDrawer.tsx (current drawer)
- apps/web/src/pages/workspace/workflowTypes.ts (types — Strategy, StrategyTarget will be there)
- apps/web/src/pages/clients/ClientProfilePage.tsx (client profile with capabilities)
- apps/web/src/pages/clients/clientTypes.ts (client/capability types)
- apps/web/src/App.tsx (routing)
- apps/web/src/theme.css (existing styles)
- apps/web/src/lib/use-api.ts (API client)

## PHASE 2: Strategy Setup Wizard

### New File: apps/web/src/pages/workspace/StrategyWizard.tsx

A multi-step wizard for creating a new Strategy. Can be opened from:
- Client profile → Capability card → "Start FY Strategy" button
- Workspace → "+ New Strategy" button

**Step 1: Client & Capability**
- Client dropdown (pre-selected if opened from client profile)
- Capability dropdown (filtered by selected client, from GET /api/clients/:id/capabilities)
- Fiscal year input (default: "FY27")
- Strategy name (auto-generated: "{FY} {Capability Name} {Category} Strategy", editable)

**Step 2: What are you filing?**
- Checkbox grid of submission types, grouped by category:
  Authorization:
    [ ] NDAA Authorization Request
  Appropriations:
    [ ] HAC Defense Programmatic (auto-checked if capability has defense PE)
    [ ] HAC [other subcommittees based on capability sector]
  Language:
    [ ] Bill/Report Language Request  
  Supporting Documents:
    [ ] Program White Paper (auto-checked if any appropriations selected)
    [ ] Meeting Request Letter
    [ ] Leave-Behind / Talking Points
    [ ] Follow-Up Letter
- Smart suggestions: if NDAA is checked, auto-suggest HAC appropriations. If appropriations checked, auto-suggest white paper.

**Step 3: Target Members**
- Search/select from Congress Directory (GET /api/directory/search or similar)
- Auto-suggest Members who sit on relevant committees based on selected submission types
- Each target shows: Member name, party, state, committee assignments
- User can add staffer name/email per target
- Table with add/remove

**Step 4: Review & Create**
- Summary card showing:
  - Strategy name, client, capability, fiscal year
  - Submissions to be created (list)
  - Target Members (list)
  - Estimated deadlines (from template contextInfo)
- "Create Strategy" button → POST /api/strategies then POST /api/strategies/:id/create-submissions then POST targets

After creation, redirect to the Strategy Dashboard.

### UI Notes:
- Use Ant Design Steps component for the wizard stepper
- Each step is a section within a single page (not separate routes)
- Back/Next buttons at bottom
- Mobile-friendly but desktop-primary
- Match existing Capiro card/form styling

## PHASE 3: Strategy Dashboard

### New File: apps/web/src/pages/workspace/StrategyDashboard.tsx

The dashboard for a single strategy. Shows all linked submissions and outreach targets.

**Header:**
- Strategy name (editable inline)
- Client name + capability name (chips)
- Fiscal year badge
- Status badge (active/complete/archived)
- Progress bar: X/Y submissions complete, Z/W targets reached

**Section 1: Submissions**
A table/card list of linked workflow instances:
| Type Badge | Title | Status | Deadline | Progress | Actions |
|---|---|---|---|---|---|
| NDAA | JaiaBot Hydro NDAA Auth | ✅ Submitted | Mar 15 | 100% | Open |
| APPR | HAC-D Appropriations | 🟡 In Progress | Mar 20 | 65% | Open |
| WP | Program White Paper | ⬜ Not Started | — | 0% | Generate |

- "Open" → opens the WorkflowDrawer for that instance
- "Generate" → for supporting docs, triggers AI generation (POST /api/workflows/instances/:id/ai-fill or a new generate endpoint)
- "+ Add Submission" → opens a mini-picker to add more instances from templates

**Section 2: Target Members & Outreach**
A table of StrategyTargets with outreach pipeline:
| Member | Committee | Outreach Status | Meeting Date | Actions |
|---|---|---|---|---|
| Sen. Wicker (R-MS) | SASC Seapower | 🟡 Meeting Scheduled | May 20 | Update |
| Rep. Calvert (R-CA) | HAC-D | ⬜ Not Started | — | Start Outreach |

- Outreach status dropdown: Not Started → Meeting Requested → Meeting Scheduled → Met → Follow-Up Sent → Complete
- "Start Outreach" → creates a meeting request letter workflow instance linked to this strategy
- "Update" → inline edit of status, meeting date, notes
- "+ Add Target" → search directory and add

**Section 3: Timeline / Activity**
Simple list of recent activity across all linked submissions:
- "NDAA Auth moved to Submitted — 2 days ago"
- "White Paper draft generated — 3 days ago"
- "Meeting with Wicker office scheduled for May 20 — 5 days ago"

### Routing:
- Add route: /workspace/strategy/:id → StrategyDashboard
- Update WorkspaceLayout.tsx: add "Strategies" tab between "Workflows" (kanban) and "Clio"
- Add route: /workspace/strategies → StrategiesList (simple list of all strategies)
- Add route: /workspace/strategy/new → StrategyWizard

### New File: apps/web/src/pages/workspace/StrategiesList.tsx
Simple list/grid of all strategies for the tenant:
- Card per strategy: name, client, fiscal year, progress (X/Y submissions), status
- Click → navigate to /workspace/strategy/:id
- "+ New Strategy" button → navigate to /workspace/strategy/new

### Update App.tsx routing:
```
<Route path="/workspace" element={<WorkspaceLayout />}>
  <Route index element={<Navigate to="/workspace/catalog" replace />} />
  <Route path="catalog" element={<CatalogView />} />
  <Route path="kanban" element={<KanbanBoard />} />
  <Route path="strategies" element={<StrategiesList />} />
  <Route path="strategy/new" element={<StrategyWizard />} />
  <Route path="strategy/:id" element={<StrategyDashboard />} />
  <Route path="clio" element={<ClioView />} />
</Route>
```

### Update WorkspaceLayout.tsx tabs:
Add "Strategies" tab with ApartmentOutlined icon between Workflows and Clio.

## CSS — Add to END of theme.css:

Strategy wizard:
- .strategy-wizard — container
- .strategy-wizard-step — step content area
- .strategy-submission-grid — checkbox grid for submission types
- .strategy-submission-item — individual checkbox card
- .strategy-target-row — member target row

Strategy dashboard:
- .strategy-dashboard — main container
- .strategy-header — header with name, badges, progress
- .strategy-progress-bar — visual progress
- .strategy-submissions — submissions section
- .strategy-submission-row — individual submission row with type badge
- .strategy-targets — targets section  
- .strategy-target-card — member target card with status pipeline
- .strategy-outreach-status — colored status indicator
- .strategy-timeline — activity timeline
- .strategy-timeline-item — individual activity entry

Strategies list:
- .strategy-card — card in the list view
- .strategy-card-progress — mini progress bar on card

Use existing CSS vars. Match Capiro styling. Government affairs professionals — clean, professional, not flashy.

## IMPORTANT:
- The wizard should pre-populate as much as possible from the capability profile
- Cross-submission auto-fill: when creating submissions via create-submissions API, the API should copy relevant data from the capability (PE, funding ask, description) into the initial formData of each instance
- The dashboard is the PRIMARY view for power users — make it information-dense but scannable
- All data comes from real API calls, not mocked
- Follow existing patterns (useApi, useQuery, useMutation, Ant Design, React Router)
