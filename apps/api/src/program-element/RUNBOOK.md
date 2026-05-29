# Program Element Sync Observability Runbook

This runbook covers PE sync metrics, alarms, health checks, and operator actions.

## Metrics (CloudWatch via structured logs)
Namespace: `Capiro/ProgramElementSync`
Dimension: `source`

Emitted metrics:
- `pe_sync.rows_inserted`
- `pe_sync.rows_updated`
- `pe_sync.rows_quarantined`
- `pe_sync.duration_seconds`
- `pe_sync.error_count`
- `pe_sync.rows_in_db`
- `pe_sync.quarantine_count`

## API Latency Metrics
Namespace: `Capiro/ApiLatency`
Dimensions: `endpoint`, `method`
Metric:
- `api.endpoint_latency_ms`

Use CloudWatch percentile statistics on `api.endpoint_latency_ms` for p50/p95/p99.

## Alarms and Response

### 1) Error count alarm
Condition:
- `pe_sync.error_count > 0` for 2 consecutive periods (any source).

Action:
1. Check latest ECS task logs for sync script.
2. Identify failing source (`source` dimension).
3. Re-run task once after transient causes (network/API).
4. If persistent, disable source schedule and open incident.

### 2) Stale sync alarm
Condition:
- `(pe_sync.rows_inserted + pe_sync.rows_updated) == 0` for 3 consecutive periods (same source).

Action:
1. Confirm source API availability.
2. Verify no schema/parsing regressions in source adapter.
3. Check if source legitimately had no updates.
4. If not legitimate, rollback recent sync code change and re-run.

### 3) Hung duration alarm
Condition:
- `pe_sync.duration_seconds > 1800`.

Action:
1. Inspect task resource usage (CPU/memory) and DB locks.
2. Check upstream source latency/throttling.
3. Kill stuck task and redeploy with backoff/limits if needed.

### 4) Quarantine pressure (health status)
Condition:
- `quarantine_count > 100` => health returns `error`.

Action:
1. Sample quarantine rows grouped by `reason` and `source`.
2. Patch parser/normalizer for dominant reason.
3. Backfill from last good checkpoint.

## Health Endpoint
`GET /health/pe`

Response:
```
{
  "status": "ok" | "degraded" | "error",
  "last_sync_at_by_source": { "r_doc_army": "...", "hasc_report": "..." },
  "rows_in_db": 123,
  "quarantine_count": 4
}
```

Status logic:
- `error`: `quarantine_count > 100`
- `degraded`: any source `last_sync_at > 48h`
- `ok`: otherwise

## Triage Commands
- API tests:
  - `npm run test -- src/health/health.controller.spec.ts src/program-element/program-element-metrics.service.spec.ts src/program-element/program-element-writer.service.spec.ts`
- CDK diff:
  - `pnpm --filter @capiro/infra-cdk diff -- --context env=dev --context account=<ACCOUNT_ID>`

## Ownership
- Primary: API/platform on-call
- Secondary: Data ingestion owner for affected source
