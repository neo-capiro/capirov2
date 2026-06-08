# Perf baselines (§21)

How to run the defense-budget-intelligence performance pass and where to record the
measured baselines against the plan's §21 latency budgets.

## §21 latency budgets

| Scenario             | Route                                      | Budget (p99) | Perf script                          |
| -------------------- | ------------------------------------------ | ------------ | ------------------------------------ |
| PE search            | `GET /api/program-elements?q=…`            | < 1000 ms    | `scripts/perf/pe-search.perf.js`     |
| PE profile           | `GET /api/program-elements/:peCode`        | < 3000 ms    | `scripts/perf/pe-profile.perf.js`    |
| Action card generation | `POST /api/intelligence/actions/generate` | < 10000 ms   | `scripts/perf/action-generate.perf.js` |

> The scripts assert against the **p99** latency. p50/p90 are also printed for context.

## Prerequisites

1. **autocannon** is not a repo dependency. Install it where you run the pass:

   ```bash
   pnpm --filter @capiro/api add -D autocannon   # or: npx autocannon
   ```

2. A **seeded target environment** with realistic dev-sized PE/program/delta data.
   Localhost against an empty DB tells you nothing — point at a seeded staging tenant.

3. An **auth token** for a `standard_user` in the target tenant (the routes are
   RolesGuard-protected). Grab a bearer token from the browser session or mint one.

## Running

```bash
export BASE_URL="https://staging.capiro.ai/api"   # default http://localhost:3000/api
export AUTH_TOKEN="<bearer token for a standard_user>"
export DURATION=20        # seconds per scenario (optional)
export CONNECTIONS=10      # concurrent connections (optional)

node scripts/perf/pe-search.perf.js
PE_CODE=0604402F node scripts/perf/pe-profile.perf.js
# WRITE path — seeded/disposable env ONLY, never prod:
node scripts/perf/action-generate.perf.js
```

Each script prints `p50 / p90 / p99` latency, mean req/s, non-2xx count, and a
PASS/FAIL against the §21 budget.

> ⚠️ `action-generate.perf.js` exercises a **write** route (it regenerates action
> cards). Run it only against a disposable/seeded environment. The read scenarios
> (search, profile) are safe to run anywhere you have a token.

## Measured baselines

> TBD — run against a seeded env and paste the numbers here. Until then these are
> **unmeasured**; do not quote a perf number that has not been recorded below.

| Scenario             | Date | Env | p50 (ms) | p90 (ms) | p99 (ms) | Budget | Pass/Fail | Notes |
| -------------------- | ---- | --- | -------- | -------- | -------- | ------ | --------- | ----- |
| PE search            | TBD  | TBD | TBD      | TBD      | TBD      | 1000   | TBD       |       |
| PE profile           | TBD  | TBD | TBD      | TBD      | TBD      | 3000   | TBD       |       |
| Action card generation | TBD  | TBD | TBD      | TBD      | TBD      | 10000  | TBD       |       |

## Acting on results

Per the plan: **fix only egregious misses** in this step; document the rest as backlog
items here (a row in the table with a `Notes` link to the tracking issue) rather than
gold-plating.
