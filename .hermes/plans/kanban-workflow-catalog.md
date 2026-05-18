# Kanban Workflow Catalog — Implementation Plan

## Feature Summary

Add a **Workspace** experience with two views:
1. **Catalog View** (landing) — Product catalog of workflow/document templates as cards
2. **Kanban View** (subtab) — Kanban board with triaged workflow items

When a user clicks "Add" on a catalog card, it creates an instance in the Kanban's **Triage** column. Clicking a triaged item opens a **Drawer Panel** with guided questions specific to that workflow type.

---

## First Workflow: NDAA Authorization Request (Program Plus-Up)

### What It Is
A written request to a Member of Congress asking them to submit a program authorization increase to HASC or SASC for inclusion in the NDAA markup. Almost always submitted alongside an Appropriations Request (Template 2.1).

### Submission Context
- **When:** Jan–Mar (windows open after PBR, first Monday in Feb; close late Feb–mid Mar for House, Mar for Senate)
- **Where:** Member's personal office (defense LA / military LA) — NOT directly to HASC/SASC
- **How:** Portal, email PDF, or in-person delivery; many offices require 1-2 page white paper

### Required Document Sections (Drawer Fields)
1. **Program Element (PE) Number** — text input
2. **Appropriation Account** — text input / dropdown
3. **Budget Activity** — text input
4. **Line Item Number** — text input
5. **Current PBR Funding Level** — currency input (for this PE/line)
6. **Requested Authorization Level** — currency input (dollar amount)
7. **Delta Above PBR** — auto-calculated (requested - current PBR)
8. **Program Description** — rich text / textarea (what the program does, current status, operational relevance)

### Data Sources Required
| Data Point | Source | Status |
|---|---|---|
| Target Member of Congress | Congress Directory (LegiStorm API) — already in platform | AVAILABLE |
| Member office defense LA contact | LegiStorm or manual entry | PARTIAL |
| Submission deadline per office | Manual entry per engagement | MANUAL |
| Submission method (portal/email/in-person) | Manual entry per engagement | MANUAL |
| PE numbers / budget line items | User-provided or future DoD budget data integration | MANUAL |
| PBR funding levels | User-provided or future DoD budget data integration | MANUAL |

---

## Architecture

### Database (Prisma Schema Additions)

```
WorkflowTemplate — catalog of available workflow types
  id, slug, name, description, category, requiredFields (JSON), isActive

WorkflowInstance — a user's in-progress workflow item on the kanban
  id, templateId (FK), tenantId, userId, clientId (FK, optional),
  status (TRIAGE | IN_PROGRESS | REVIEW | SUBMITTED | COMPLETE),
  formData (JSON), targetMemberId (FK to directory), 
  submissionDeadline, submissionMethod,
  createdAt, updatedAt

KanbanColumn — configurable columns per tenant (seeded with defaults)
  id, tenantId, name, position, color
```

### API Endpoints (NestJS modules)

New module: `apps/api/src/workflows/`

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /workflows/templates | List all workflow templates (catalog) |
| GET | /workflows/templates/:slug | Get single template detail |
| POST | /workflows/instances | Create instance (Add to Triage) |
| GET | /workflows/instances | List user's workflow instances (kanban) |
| PATCH | /workflows/instances/:id | Update instance (form data, status, column) |
| DELETE | /workflows/instances/:id | Remove instance |
| GET | /workflows/columns | Get kanban columns |

### Frontend (React)

New page: `apps/web/src/pages/workspace/`

| Component | Purpose |
|---|---|
| WorkspacePage | Container with subtab navigation (Catalog / Kanban) |
| CatalogView | Grid of WorkflowTemplateCards |
| WorkflowTemplateCard | Card with name, description, "Add" button |
| KanbanBoard | Drag-and-drop columns with workflow instance cards |
| KanbanColumn | Single column (Triage, In Progress, Review, etc.) |
| KanbanCard | Instance card showing workflow name, client, status |
| WorkflowDrawer | Right-side drawer panel with form fields |
| NdaaAuthForm | NDAA-specific form fields inside the drawer |

---

## Kanban Columns (Default)

1. **Triage** — newly added, not started
2. **In Progress** — actively filling out / drafting
3. **Under Review** — internal review before submission
4. **Submitted** — sent to member office
5. **Complete** — confirmed received / acknowledged

---

## Implementation Order

### Phase 1: Data Model & API
- [ ] Add Prisma schema (WorkflowTemplate, WorkflowInstance)
- [ ] Run migration
- [ ] Seed NDAA Authorization Request template
- [ ] Build workflows NestJS module (CRUD endpoints)

### Phase 2: Catalog View (Frontend)
- [ ] Add Workspace page with subtab navigation
- [ ] Build CatalogView with template cards
- [ ] Wire "Add" button to POST /workflows/instances

### Phase 3: Kanban Board (Frontend)
- [ ] Build KanbanBoard with columns
- [ ] Render workflow instances as cards in correct columns
- [ ] Add drag-and-drop between columns (status update)

### Phase 4: Workflow Drawer
- [ ] Build WorkflowDrawer component (slides from right)
- [ ] Build NdaaAuthForm with all required fields
- [ ] Auto-calculate delta above PBR
- [ ] Wire Congress Directory lookup for target member
- [ ] Auto-save form data on change

---

## UX Notes
- Non-tech-savvy users: keep the catalog cards simple with clear CTAs
- Drawer should feel like a guided form, not a data dump
- Group NDAA fields into logical sections (Program Info, Funding, Description)
- Show progress indicator in drawer (e.g., 4/8 fields complete)
