# Capiro SOC 2 Control Mapping

Status: internal control-narrative draft (engineering source-of-truth). Pairs
the platform's technical controls to the SOC 2 Trust Services Criteria (TSC,
2017 w/ 2022 points-of-focus). This is the engineering evidence map an auditor
or our compliance lead consumes; it is not itself an attestation.

Scope: `apps/api` (NestJS), `apps/web` (React), AWS infra in `infra/` (ECS
Fargate behind ALB, Aurora PostgreSQL in a private VPC, Clerk for identity).

---

## 1. Control-to-criteria map

| TSC | Criterion (summary) | How Capiro satisfies it | Primary evidence |
|-----|---------------------|-------------------------|------------------|
| CC6.1 | Logical access — authentication | Clerk-managed identity; all API routes require a verified session; no anonymous write paths. | Clerk dashboard; `apps/api` auth guards |
| CC6.1 | Logical access — tenant isolation | Every privileged query runs inside `prisma.withTenant(tenantId, …)`; row access is tenant-scoped at the DB layer. | `directory.service.ts`, `*-read.service.ts` `withTenant` usage |
| CC6.2 | Provisioning / deprovisioning | User lifecycle managed in Clerk; role (`actorRole`) carried into every request context. | Clerk; request `ctx.role` |
| CC6.3 | Least privilege / role enforcement | Role checked before sensitive reads/writes; admin-only actions (impersonation) gated to Capiro-admin. | `capiro-admin.service.ts` |
| CC6.6 | Network boundary protection | Aurora is in a **private VPC** (no public endpoint); only ECS tasks in the VPC reach it; ALB terminates TLS. | `infra/` CDK; VPC/SG config |
| CC6.7 | Data-in-transit / at-rest | TLS at ALB; Aurora storage encryption; secrets in AWS Secrets Manager (`capiro/dev/<name>`). | ACM cert; Secrets Manager |
| CC7.1 | Detection of security events | Structured app logs to CloudWatch (`/capiro/dev/api`); audit log captures privileged actions. | CloudWatch log groups; `audit_log` table |
| CC7.2 | Monitoring / anomaly response | Health endpoint + CloudWatch alarms; audit trail supports after-the-fact investigation. | `health.controller.ts`; CloudWatch |
| CC7.3 / CC7.4 | Incident evaluation & response | Audit log + log retention give the timeline needed to scope and respond. | `audit_log`; CloudWatch retention |
| CC8.1 | Change management | All changes via PR + CI (typecheck + jest/vitest gates) before merge; infra via reviewed CDK. | GitHub PR history; CI config |
| A1.x (Availability) | Aurora automated backups; multi-AZ Fargate behind ALB. | `infra/` Aurora backup window/retention |
| C1.x (Confidentiality) | Tenant isolation + audit on confidential reads (e.g. member FEC summary view). | `directory.member_fec_summary.view` audit action |
| P-series (Privacy) | PII (contacts, personnel) is tenant-scoped; access to sensitive summaries is audit-logged. | `acquisition_personnel.*` audit actions |

---

## 2. Audit-log coverage (CC7.1 / C1 evidence)

Privileged and confidential-data actions write to the tenant-scoped `audit_log`
table. Each row records: `tenantId`, `actorUserId`, `actorRole`, `action`,
`entityType`, `entityId`, and a structured `after` (and where relevant `before`)
payload, all inside `prisma.withTenant(...)` so the audit row is itself
tenant-isolated.

Actions currently emitted (source-verified):

| Action | Module | Trust-criteria relevance |
|--------|--------|--------------------------|
| `impersonation.start` | `capiro-admin.service.ts` | CC6.3 — privileged admin access |
| `directory.member_fec_summary.view` | `directory.service.ts` | C1 — confidential FEC summary read |
| `directory_contact_note.created` | `directory.service.ts` | CC7.1 — data mutation |
| `program_element.watch.set` | `program-element-read.service.ts` | CC7.1 — user config change |
| `acquisition_personnel.list` | `acquisition-personnel-read.service.ts` | P — PII listing access |
| `acquisition_personnel.detail` | `acquisition-personnel-read.service.ts` | P — PII detail access |
| `acquisition_personnel.crm_link` | `acquisition-personnel-read.service.ts` | CC7.1 — data linkage mutation |
| `acquisition_personnel.merge_queue.list` | `acquisition-personnel-read.service.ts` | CC7.1 — review-queue access |
| `acquisition_personnel.merge_queue.resolve` | `acquisition-personnel-read.service.ts` | CC8.1 — data-quality change |
| `program_element.personnel.list` | `acquisition-personnel-read.service.ts` | P — personnel access |
| `program_element.person_candidate.list` | `acquisition-personnel-read.service.ts` | CC7.1 — candidate review access |
| `program_element.person_candidate.resolve` | `acquisition-personnel-read.service.ts` | CC8.1 — entity-resolution change |
| `program_element.person_candidate.suggest` | `acquisition-personnel-read.service.ts` | CC7.1 — suggestion event |

> Note: Clio agent `trace` entries (`tool`/`action` selected/skipped in
> `clio.service.ts`) are runtime reasoning traces, **not** SOC 2 audit-log
> entries — they do not write to `audit_log` and are excluded from this map.

### Coverage gaps / roadmap (tracked, not yet closed)

- **Read-coverage breadth:** not every confidential read is audited yet (e.g.
  bulk program-element views). Expand audit emission to remaining
  confidential-read endpoints.
- **Tamper-evidence:** `audit_log` is append-only by convention, not yet
  enforced (no DB-level immutability / WORM). Add a revoke of UPDATE/DELETE on
  the table for the app role.
- **Retention policy:** define and document explicit `audit_log` + CloudWatch
  retention durations to satisfy CC7.3/CC7.4 evidence horizons.
- **Failed-access logging:** auth/authorization *denials* are not yet written to
  `audit_log` (only successful privileged actions). Add denial events for CC7.1.

---

## 3. How to regenerate the audit-action inventory

The action table above is source-derived. To refresh it, list all emitted audit
actions:

```bash
# from repo root
rg -n "action: '[a-z._]+'" apps/api/src --no-heading
```

Cross-check each hit is wrapped in `prisma.withTenant(...)` and writes via
`tx.auditLog.create({ ... })`.
