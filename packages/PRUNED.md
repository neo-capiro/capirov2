# Schema Split — Change Record (SOC2 change-management evidence)

**Date:** 2026-06-13
**Author:** Hermes (capiro-devbox), under Neo's approval
**Context:** prod-os-capiro cost-optimized data architecture. The single 3,737-line
`apps/api/prisma/schema.prisma` (131 models) is split into two physical databases:

- `packages/db-tenant/prisma/schema.prisma` — 57 tenant/user-scoped models. The ONLY
  schema prod-os-capiro migrates/writes. Lives in the new small prod Aurora.
- `packages/db-reference/prisma/schema.prisma` — 74 reference/bulk models. READ-ONLY,
  served from the existing capiro-dev Aurora. prod-os-capiro NEVER migrates or writes these.

This is a derivation snapshot of capirov2 schema at HEAD on 2026-06-13. It is NOT yet wired
into the app; it is the Phase-1 data-layer design awaiting deploy + app refactor (Phase 2+).

## Cross-database foreign keys severed (2 total)
Postgres FKs cannot span two physical DBs. These relation FIELDS were removed from the
tenant schema; the scalar FK COLUMN is retained so the join resolves at the application
layer (service-level lookup against the reference client).

| Tenant model        | Dropped relation field                          | Retained scalar column | App-level resolution |
|---------------------|--------------------------------------------------|------------------------|----------------------|
| ProgramElementWatch | `programElement ProgramElement @relation(...)`   | `peCode`               | Look up ProgramElement by peCode via reference client |
| WorkflowInstance    | `template WorkflowTemplate @relation(...)`       | `templateId`           | Look up WorkflowTemplate by id via reference client |

The corresponding back-reference fields on the reference side (ProgramElement.watches,
WorkflowTemplate.instances) were also removed from the reference schema.

## SOC2 follow-ups (tracked, to apply during Phase 2 app refactor — NOT auto-applied here)
- Add standard audit columns (created_by/updated_by/created_at/updated_at/deleted_at) to
  tenant models missing them (modular plan §7).
- Enable Postgres RLS on high-sensitivity tenant tables: Client, MailMessage/MailThread,
  ClioMemory, ContextEmbedding, AuditLog, IntegrationConnection(+Token), Meeting* — all
  access via `prisma.withTenant(tenantId, ...)` (capiro-ops pitfall: bare findMany returns
  0 rows under RLS).
- Reference DB access uses a dedicated LEAST-PRIVILEGE read-only role on capiro-dev
  (SELECT only, reference tables only). No write grant.

## Dead-code / prune review (CLEAN REBUILD principle) — PENDING
The 57 tenant models were partitioned mechanically by `tenantId` presence. A per-model
"is this actually used in apps/api?" prune pass is still owed before these schemas are
wired into the app. Candidates to scrutinize (flagged, not yet removed): DemoRequest,
ClerkEvent, ImpersonationSession usage, and any Clio* tables superseded by newer ones.
Document removals here as they happen.
