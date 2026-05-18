TASK: Phase 1 — Strategy data model, migration, and full CRUD API.

## CONTEXT — READ FIRST:
- apps/api/prisma/schema.prisma (all existing models — follow conventions exactly)
- apps/api/src/workflows/workflows.controller.ts (endpoint patterns)
- apps/api/src/workflows/workflows.service.ts (service patterns)
- apps/api/src/workflows/workflows.module.ts (module patterns)
- apps/web/src/pages/workspace/workflowTypes.ts (frontend types)

## CONCEPT
A "Strategy" is a container that groups multiple workflow instances (submissions) + target Members of Congress into a coordinated package. Think of it as "FY27 JaiaBot Hydro Defense Strategy" containing an NDAA auth, HAC-D appropriations, white paper, and outreach letters — all linked.

## SCHEMA — Add to END of schema.prisma

```prisma
model Strategy {
  id              String   @id @default(uuid()) @db.Uuid
  tenantId        String   @map("tenant_id") @db.Uuid
  clientId        String   @map("client_id") @db.Uuid
  capabilityId    String?  @map("capability_id") @db.Uuid
  createdByUserId String?  @map("created_by_user_id") @db.Uuid
  name            String
  fiscalYear      String?  @map("fiscal_year")  // "FY27"
  status          String   @default("active")     // active, complete, archived
  description     String?  @db.Text
  submissionTypes Json     @default("[]") @map("submission_types_jsonb")  // ["ndaa_auth", "hac_defense", "white_paper"]
  settings        Json     @default("{}") @map("settings_jsonb")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant     Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  client     Client              @relation(fields: [clientId], references: [id], onDelete: Cascade)
  capability ClientCapability?   @relation(fields: [capabilityId], references: [id], onDelete: SetNull)
  createdBy  User?               @relation("StrategyCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)
  targets    StrategyTarget[]
  instances  WorkflowInstance[]

  @@index([tenantId, clientId, status], map: "strategies_tenant_client_status_idx")
  @@map("strategies")
}

model StrategyTarget {
  id                  String   @id @default(uuid()) @db.Uuid
  tenantId            String   @map("tenant_id") @db.Uuid
  strategyId          String   @map("strategy_id") @db.Uuid
  memberName          String   @map("member_name")
  memberTitle         String?  @map("member_title")
  memberParty         String?  @map("member_party")
  memberState         String?  @map("member_state")
  committee           String?
  subcommittee        String?
  stafferName         String?  @map("staffer_name")
  stafferEmail        String?  @map("staffer_email")
  directoryContactId  String?  @map("directory_contact_id")
  outreachStatus      String   @default("not_started") @map("outreach_status") // not_started, meeting_requested, meeting_scheduled, met, follow_up_sent, complete
  meetingDate         DateTime? @map("meeting_date") @db.Timestamptz(6)
  notes               String?  @db.Text
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy @relation(fields: [strategyId], references: [id], onDelete: Cascade)

  @@index([tenantId, strategyId], map: "strategy_targets_tenant_strategy_idx")
  @@map("strategy_targets")
}
```

Also add relation fields:
- WorkflowInstance: add `strategyId String? @map("strategy_id") @db.Uuid` and `strategy Strategy? @relation(fields: [strategyId], references: [id], onDelete: SetNull)` 
- Tenant: add `strategies Strategy[]`, `strategyTargets StrategyTarget[]`
- Client: add `strategies Strategy[]`
- ClientCapability: add `strategies Strategy[]`
- User: add `strategies Strategy[] @relation("StrategyCreator")`

## MIGRATION
```
cd apps/api && npx prisma migrate dev --name add-strategies --create-only
```

IMPORTANT: After generating, EDIT the migration SQL to ONLY include:
- CREATE TABLE strategies
- CREATE TABLE strategy_targets  
- ALTER TABLE workflow_instances ADD COLUMN strategy_id
- CREATE INDEX for strategy_id on workflow_instances
- All AddForeignKey statements for the new tables + strategy_id column

DO NOT include any DropForeignKey/AddForeignKey for existing tables. The auto-generator will try to recreate all FKs — strip those out. Only keep SQL for the NEW tables and the new strategy_id column.

## API — New module: apps/api/src/strategies/

Create:
- strategies.module.ts (imports PrismaModule, ConfigModule)
- strategies.controller.ts
- strategies.service.ts
- dto/create-strategy.dto.ts
- dto/update-strategy.dto.ts

### Endpoints:

**Strategy CRUD:**
- POST /api/strategies — create strategy { name, clientId, capabilityId?, fiscalYear?, description?, submissionTypes? }
- GET /api/strategies — list strategies for tenant (filterable by clientId, status)
- GET /api/strategies/:id — get strategy with targets + linked workflow instances (include template on instances)
- PATCH /api/strategies/:id — update strategy fields
- DELETE /api/strategies/:id — delete strategy (unlinks instances, doesn't delete them)

**Strategy Targets:**
- POST /api/strategies/:id/targets — add target Member { memberName, memberTitle, committee, subcommittee, stafferName, stafferEmail, directoryContactId? }
- PATCH /api/strategies/:strategyId/targets/:targetId — update target (outreachStatus, meetingDate, notes)
- DELETE /api/strategies/:strategyId/targets/:targetId — remove target

**Link/Unlink Instances:**
- POST /api/strategies/:id/link-instance — { instanceId } — sets strategyId on the workflow instance
- POST /api/strategies/:id/unlink-instance — { instanceId } — clears strategyId
- POST /api/strategies/:id/create-submissions — auto-create workflow instances from submissionTypes array. For each type in the array, look up the template by slug and create an instance with the strategy's clientId and strategyId pre-set. Return created instances.

### Register module in app.module.ts

Follow exact patterns from WorkflowsModule registration.

## FRONTEND TYPES

Add to apps/web/src/pages/workspace/workflowTypes.ts:

```typescript
export interface Strategy {
  id: string;
  tenantId: string;
  clientId: string;
  capabilityId: string | null;
  name: string;
  fiscalYear: string | null;
  status: string;
  description: string | null;
  submissionTypes: string[];
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; name: string };
  capability?: { id: string; name: string; fundingAsk: number | null };
  targets?: StrategyTarget[];
  instances?: (WorkflowInstance & { template: WorkflowTemplate })[];
}

export interface StrategyTarget {
  id: string;
  strategyId: string;
  memberName: string;
  memberTitle: string | null;
  memberParty: string | null;
  memberState: string | null;
  committee: string | null;
  subcommittee: string | null;
  stafferName: string | null;
  stafferEmail: string | null;
  directoryContactId: string | null;
  outreachStatus: string;
  meetingDate: string | null;
  notes: string | null;
}
```

## IMPORTANT
- Follow EXACT Prisma conventions (@@map snake_case, tenant_id, timestamps, etc.)
- Follow EXACT NestJS patterns from workflows module (RolesGuard, @CurrentTenant, etc.)
- The migration MUST be manually cleaned to avoid FK recreation issues (we hit this before)
- The create-submissions endpoint is key — it's what the wizard calls to batch-create all submissions in one click
