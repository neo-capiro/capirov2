TASK: Add a Workflows feature to the Capiro platform — Phase 1: Data Model + API.

## CONTEXT
This is a pnpm monorepo with:
- apps/api (NestJS + Prisma ORM + PostgreSQL)
- apps/web (React + Ant Design + React Query)
- packages/shared

The project uses Clerk auth, UUIDs for IDs, tenant-scoped models (every table has tenantId), and @@map("snake_case") naming for Postgres tables. All timestamps use @db.Timestamptz(6). JSON columns use @map("foo_jsonb"). Follow existing schema conventions EXACTLY.

## WHAT TO BUILD

### 1. Prisma Schema Additions (apps/api/prisma/schema.prisma)

Add these new enums and models at the END of the existing schema file (do NOT modify existing models except to add relation fields to Tenant, User, and Client):

New enum:
```
enum WorkflowStatus {
  triage
  in_progress
  review
  submitted
  complete
  cancelled

  @@map("workflow_status")
}
```

New model WorkflowTemplate:
```
model WorkflowTemplate {
  id               String   @id @default(uuid()) @db.Uuid
  slug             String   @unique
  name             String
  description      String?  @db.Text
  category         String   @default("authorization")
  requiredSections Json     @default("[]") @map("required_sections_jsonb")
  contextInfo      Json     @default("{}") @map("context_info_jsonb")
  isActive         Boolean  @default(true) @map("is_active")
  sortOrder        Int      @default(0) @map("sort_order")
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  instances WorkflowInstance[]

  @@map("workflow_templates")
}
```

New model WorkflowInstance:
```
model WorkflowInstance {
  id                 String         @id @default(uuid()) @db.Uuid
  tenantId           String         @map("tenant_id") @db.Uuid
  templateId         String         @map("template_id") @db.Uuid
  createdByUserId    String?        @map("created_by_user_id") @db.Uuid
  clientId           String?        @map("client_id") @db.Uuid
  title              String
  status             WorkflowStatus @default(triage)
  formData           Json           @default("{}") @map("form_data_jsonb")
  targetMemberId     String?        @map("target_member_id")
  submissionDeadline DateTime?      @map("submission_deadline") @db.Date
  submissionMethod   String?        @map("submission_method")
  notes              String?        @db.Text
  completedAt        DateTime?      @map("completed_at") @db.Timestamptz(6)
  createdAt          DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime       @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant    Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  template  WorkflowTemplate @relation(fields: [templateId], references: [id], onDelete: Restrict)
  createdBy User?            @relation("WorkflowInstanceCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)
  client    Client?          @relation(fields: [clientId], references: [id], onDelete: SetNull)

  @@index([tenantId, status, createdAt], map: "workflow_instances_tenant_status_created_idx")
  @@index([tenantId, clientId, status], map: "workflow_instances_tenant_client_status_idx")
  @@index([tenantId, templateId], map: "workflow_instances_tenant_template_idx")
  @@map("workflow_instances")
}
```

Also add these relation fields to existing models:
- Tenant model: add `workflowInstances WorkflowInstance[]`
- User model: add `workflowInstances WorkflowInstance[] @relation("WorkflowInstanceCreator")`
- Client model: add `workflowInstances WorkflowInstance[]`

### 2. Prisma Migration
After modifying the schema, create a migration with:
```
cd apps/api && npx prisma migrate dev --name add-workflow-models --create-only
```
IMPORTANT: Only create the migration file, do NOT actually run it against a database. The --create-only flag handles this.

### 3. Seed Script (apps/api/prisma/seed-workflows.ts)
Create a seed script that upserts the first WorkflowTemplate. The NDAA Authorization Request template:

- slug: "ndaa-authorization-request"
- name: "NDAA Authorization Request"
- description: "A written request to a Member of Congress asking them to submit a program authorization increase to HASC or SASC for inclusion in the NDAA markup. Also called a program plus-up. Almost always submitted alongside an Appropriations Request."
- category: "authorization"
- sortOrder: 1
- requiredSections JSON array with these fields:
  1. pe_number (text, required, section: program_info) - "The PE number for the defense program"
  2. appropriation_account (text, required, section: program_info) - "The appropriation account (e.g., RDT&E, Procurement)"
  3. budget_activity (text, required, section: program_info) - "The budget activity number"
  4. line_item_number (text, required, section: program_info) - "The specific line item number"
  5. current_pbr_funding (currency, required, section: funding) - "Current funding level in the President's Budget Request for this PE/line"
  6. requested_authorization (currency, required, section: funding) - "The dollar amount you are requesting Congress to authorize"
  7. delta_above_pbr (currency, not required, section: funding, computed: true) - "Auto-calculated: Requested Authorization minus Current PBR"
  8. program_description (textarea, required, section: description) - "What the program does, its current status, and operational relevance"

- contextInfo JSON object with:
  - overview: about the NDAA authorization request
  - timing: window opens in January after PBR (first Monday in Feb), House deadline late Feb to mid-March, Senate deadline March, some offices as early as third week of January
  - submission: where (member's personal office, defense LA / military LA, NOT directly to HASC/SASC), how (portal, email PDF, in-person, 1-2 page white paper), format varies by office
  - why: NDAA is primary vehicle for new defense program authority, increasing funding ceilings above PBR
  - companion: "Almost always submitted alongside Template 2.1 (Appropriations Request)"

### 4. NestJS Workflows Module (apps/api/src/workflows/)

Create a new NestJS module following the exact patterns from apps/api/src/engagement/ and apps/api/src/clio/:

**Files to create:**
- apps/api/src/workflows/workflows.module.ts
- apps/api/src/workflows/workflows.controller.ts
- apps/api/src/workflows/workflows.service.ts
- apps/api/src/workflows/dto/create-workflow-instance.dto.ts
- apps/api/src/workflows/dto/update-workflow-instance.dto.ts

**Module:** Import PrismaModule. Export WorkflowsService.

**Controller endpoints (all tenant-scoped, require auth):**
- GET /api/workflows/templates — list all active templates (sorted by sortOrder)
- GET /api/workflows/templates/:slug — get single template by slug
- POST /api/workflows/instances — create a new workflow instance (Add to Triage)
- GET /api/workflows/instances — list workflow instances for current tenant (filterable by status, clientId)
- GET /api/workflows/instances/:id — get single instance with template included
- PATCH /api/workflows/instances/:id — update instance (formData, status, title, notes, etc.)
- DELETE /api/workflows/instances/:id — hard-delete instance

**DTOs:**
CreateWorkflowInstanceDto: { templateSlug: string, clientId?: string, title?: string }
UpdateWorkflowInstanceDto: { status?: WorkflowStatus, formData?: Record<string,any>, title?: string, notes?: string, targetMemberId?: string, submissionDeadline?: string, submissionMethod?: string }

**Service:** Use PrismaService for all database access. Follow the same patterns as EngagementService. Include tenant scoping on ALL queries (where: { tenantId }).

**IMPORTANT:** Look at how existing controllers extract tenantId and userId from the request. Follow the exact same auth pattern (decorators, guards, request types) used in EngagementController or the Clio controller. Read those files first.

### 5. Register the module
Add WorkflowsModule to the imports array in apps/api/src/app.module.ts.

DO NOT touch any frontend files. DO NOT run the migration against a real database. Only create the migration file with --create-only.
