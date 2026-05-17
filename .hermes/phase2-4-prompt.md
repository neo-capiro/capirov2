TASK: Add Workflow Catalog and Kanban views to the Capiro Workspace — Phases 2-4.

## CONTEXT
Read these files FIRST before writing any code:
- apps/web/src/App.tsx (routing)
- apps/web/src/components/AppShell.tsx (navigation, page config, client dropdown logic)
- apps/web/src/pages/workspace/WorkspacePage.tsx (current Clio workspace)
- apps/web/src/lib/use-api.ts (API client hook)
- apps/web/src/theme.css (existing styles — 5400+ lines, CSS vars: --app-bg-0, --app-bg-1, --ink-900, --ink-700, --line-soft)
- apps/web/src/pages/engagement/EngagementPage.tsx (for subtab pattern reference)
- apps/web/src/pages/clients/ClientWorkspacePage.tsx (for layout pattern reference)

This is a React + TypeScript + Ant Design + React Query app with Clerk auth. The API client is obtained via useApi() hook.

## ARCHITECTURE DECISION — IMPORTANT
The current WorkspacePage.tsx is a full Clio AI chat workspace. We are NOT replacing it. Instead, restructure the /workspace route to support subtab navigation:

1. /workspace → redirects to /workspace/catalog (new default)
2. /workspace/catalog → Workflow Catalog (grid of template cards)
3. /workspace/kanban → Kanban Board (workflow instances by status column)
4. /workspace/clio → Clio AI (move current WorkspacePage content here)

## WHAT TO BUILD

### File 1: apps/web/src/pages/workspace/WorkspaceLayout.tsx
A layout wrapper with subtab navigation at the top. Pattern: look at how EngagementPage.tsx or SettingsLayout.tsx handles subtabs/sub-navigation.

Subtabs:
- "Library" → /workspace/catalog (icon: AppstoreOutlined)
- "Workflows" → /workspace/kanban (icon: ProjectOutlined)
- "Clio" → /workspace/clio (icon: RobotOutlined)

Use Ant Design Segmented or simple tab-like buttons matching the app's design language. The layout renders an <Outlet /> below the tabs for the active view.

### File 2: apps/web/src/pages/workspace/CatalogView.tsx
A grid of workflow template cards fetched from GET /api/workflows/templates.

Each card shows:
- Template name (bold)
- Template description (2-3 lines, truncated)
- Category badge/tag
- "Add to Workflows" button (primary, with PlusOutlined icon)

Clicking "Add to Workflows" calls POST /api/workflows/instances with { templateSlug: template.slug } and then:
1. Shows a success message
2. Navigates to /workspace/kanban so the user sees their new item in Triage

Use Ant Design Card components in a responsive grid (CSS grid or Row/Col). Cards should feel simple and inviting for non-tech-savvy users.

Types needed:
```typescript
interface WorkflowTemplate {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  requiredSections: FieldDefinition[];
  contextInfo: Record<string, unknown>;
  isActive: boolean;
  sortOrder: number;
}

interface FieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'currency' | 'textarea';
  required: boolean;
  section: string;
  description?: string;
  computed?: boolean;
}
```

### File 3: apps/web/src/pages/workspace/KanbanBoard.tsx
A kanban board with 5 columns. Fetch instances from GET /api/workflows/instances.

Columns (in order):
1. Triage (default for new items)
2. In Progress
3. Under Review
4. Submitted
5. Complete

Each column shows the count of items. Each card shows:
- Workflow title
- Template name (small/secondary)
- Client name if associated (small tag)
- Created date (relative time)

DRAG AND DROP: Use HTML5 native drag-and-drop (onDragStart, onDragOver, onDrop). When a card is dropped on a different column, call PATCH /api/workflows/instances/:id with { status: newStatus } and optimistically update the UI.

Status mapping to column:
- triage → "Triage"
- in_progress → "In Progress"
- review → "Under Review"
- submitted → "Submitted"
- complete → "Complete"

Clicking on a card opens the WorkflowDrawer (File 4).

### File 4: apps/web/src/pages/workspace/WorkflowDrawer.tsx
A right-side Ant Design Drawer that opens when clicking a kanban card.

The drawer shows:
1. Header: workflow title (editable), status badge, template name
2. Context section: collapsible panel showing the template's contextInfo (timing, submission details, etc.) — this is the "what/when/where/how" guide
3. Form sections grouped by the template's requiredSections field groupings:
   - "Program Info" section: PE Number, Appropriation Account, Budget Activity, Line Item Number
   - "Funding" section: Current PBR Funding, Requested Authorization, Delta Above PBR (auto-calculated)
   - "Description" section: Program Description (textarea)
4. Additional fields: Target Member (text input for now), Submission Deadline (DatePicker), Submission Method (Select: portal/email/in-person), Notes (textarea)
5. Footer: Save button, Delete button

Form behavior:
- Load existing formData from the instance
- Auto-calculate delta_above_pbr = requested_authorization - current_pbr_funding (show as read-only)
- Currency fields should format with $ prefix and comma separators
- Save calls PATCH /api/workflows/instances/:id with the updated formData + other fields
- Show a progress indicator: "X of Y required fields completed"
- Debounced auto-save (save 1.5s after last change) — show "Saving..." / "Saved" indicator

### File 5: apps/web/src/pages/workspace/ClioView.tsx
Move the ENTIRE current WorkspacePage.tsx content into this file, renamed to ClioView. Keep all the Clio logic intact, just rename the export.

### File 6: Update apps/web/src/pages/workspace/WorkspacePage.tsx
Replace the current content with a simple component that renders WorkspaceLayout (which handles the subtab routing internally), OR make WorkspacePage the layout itself. Ensure the /workspace/* route in App.tsx works with the new structure.

### File 7: Update apps/web/src/App.tsx
Update the workspace route to support the new sub-routes:
```
<Route path="/workspace" element={<WorkspaceLayout />}>
  <Route index element={<Navigate to="/workspace/catalog" replace />} />
  <Route path="catalog" element={<CatalogView />} />
  <Route path="kanban" element={<KanbanBoard />} />
  <Route path="clio" element={<ClioView />} />
</Route>
```

Remove or update the old workspace import. Import the new components.

### File 8: Add styles to apps/web/src/theme.css
Add CSS at the END of the file for the new components. Follow the existing naming conventions (BEM-like with component prefixes). Key styles needed:

- .workspace-tabs — subtab navigation bar
- .catalog-grid — responsive card grid
- .catalog-card — template card styling
- .kanban-board — horizontal scrollable flex container
- .kanban-column — individual column
- .kanban-card — draggable card
- .kanban-card.is-dragging — visual feedback during drag
- .kanban-column.drag-over — column highlight when dragging over
- .workflow-drawer — drawer customizations
- .workflow-drawer-progress — progress indicator
- .workflow-drawer-context — collapsible context panel
- .workflow-field-section — grouped form section

Use existing CSS variables. Cards should have the same border-radius and shadow as .ant-card in the existing theme. Keep it clean and professional — government affairs users, not developers.

### File 9: Update apps/web/src/components/AppShell.tsx
In the pageConfigFor function, update the workspace handling so the page title changes based on the sub-route:
- /workspace/catalog → title: "Workspace" 
- /workspace/kanban → title: "Workspace"
- /workspace/clio → title: "Workspace"
Keep it as "Workspace" for all — the subtabs handle the context.

Also ensure showClientDropdown is true for /workspace/kanban and /workspace/catalog (users may want to filter by client).

DO NOT break any existing functionality. The Clio workspace must continue working exactly as before at /workspace/clio.
