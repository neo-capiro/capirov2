TASK: Finish the Workflows API module for Capiro — Phase 1 completion.

The Prisma schema, migration, seed, module file, and CreateWorkflowInstanceDto already exist. You need to create the remaining files:

1. apps/api/src/workflows/dto/update-workflow-instance.dto.ts
2. apps/api/src/workflows/workflows.service.ts
3. apps/api/src/workflows/workflows.controller.ts
4. Register WorkflowsModule in apps/api/src/app.module.ts

IMPORTANT: Before writing any code, READ these files first to understand the exact auth patterns, decorators, and request typing used in this project:
- apps/api/src/engagement/engagement.controller.ts
- apps/api/src/engagement/engagement.service.ts  
- apps/api/src/clio/clio.module.ts (to see how modules are structured)
- apps/api/src/app.module.ts (to see import pattern)
- apps/api/src/auth/ (to understand auth decorators and guards)

Match the patterns EXACTLY. Do not invent your own auth approach.

## What each file should do:

### update-workflow-instance.dto.ts
Optional fields: status (WorkflowStatus enum), formData (object), title (string), notes (string), targetMemberId (string), submissionDeadline (string/date), submissionMethod (string). Use class-validator decorators matching the style in create-workflow-instance.dto.ts.

### workflows.service.ts
- Inject PrismaService
- listTemplates(): return active templates sorted by sortOrder
- getTemplateBySlug(slug): find unique or throw NotFoundException
- createInstance(tenantId, userId, dto): look up template by slug, create instance with status=triage, auto-generate title from template name if not provided
- listInstances(tenantId, filters?): list instances with template included, filterable by status and clientId, ordered by createdAt desc
- getInstance(tenantId, id): find instance with template, throw if not found or wrong tenant
- updateInstance(tenantId, id, dto): update instance, set completedAt if status changes to complete
- deleteInstance(tenantId, id): delete instance, verify tenant ownership first

### workflows.controller.ts
All endpoints under /api/workflows prefix. Follow the auth pattern from EngagementController exactly (same decorators, same way to extract tenantId and userId from request).

Routes:
- GET /api/workflows/templates
- GET /api/workflows/templates/:slug
- POST /api/workflows/instances (body: CreateWorkflowInstanceDto)
- GET /api/workflows/instances (query: status?, clientId?)
- GET /api/workflows/instances/:id
- PATCH /api/workflows/instances/:id (body: UpdateWorkflowInstanceDto)
- DELETE /api/workflows/instances/:id

### app.module.ts
Add WorkflowsModule to the imports array, following the same import style as other modules.
