# Capiro Ingestion Schedule Matrix (daily vs periodic)

Cadence rationale per source: how often the upstream data actually changes vs. cost/rate-limits.
Times are UTC, staggered to avoid overlap and to respect dependency order
(SOURCES → DERIVED/EMITTERS → EMBEDDINGS → MV REFRESH). All jobs incremental via SyncRun `--since`
unless marked FULL (cheap full-refresh-by-upsert).

LEGEND: 🟢 daily · 🔵 weekly · 🟣 monthly · 🟠 seasonal/manual · ⚙️ derived (after sources)

## TIER 1 — DAILY 🟢 (fast-moving, lobbyist-facing)
| Job | Cron (UTC) | Why daily | Mode |
|-----|-----------|-----------|------|
| sync-congress | 0 6 * * * | Bills/actions change daily when in session | incremental --since |
| sync-federal-register | 15 6 * * * | New rules/notices daily | incremental --since |
| sync-regulations | 30 6 * * * | Docket comment activity daily | incremental --since |
| sync-hearings | 45 6 * * * | Hearing schedules update daily | incremental --since |
| sync-rss-intel | 0 */6 * * * | News 4x/day | FULL (upsert) |
| sync-fec | 0 7 * * * | Contributions filed continuously | incremental (date-bounded) |
| sync-fec-pac | 20 7 * * * | PAC (Sched B) giving | incremental (date-bounded) |
| sync-federal-award | 40 7 * * * | New awards daily | incremental --since |
| enrich-award-districts | 0 8 * * * | After awards land | ⚙️ after sync-federal-award |

## TIER 2 — WEEKLY 🔵 (slower-moving)
| Job | Cron (UTC) | Why weekly | Mode |
|-----|-----------|-----------|------|
| sync-lda | 0 5 * * 1 | LDA filings quarterly-heavy; weekly catches amendments | incremental |
| sync-openlobby | 30 5 * * 1 | Derived lobby intel | incremental --since |
| sync-fara | 0 6 * * 1 | FARA registrations slow | incremental --since |
| sync-gao | 30 6 * * 1 | GAO reports weekly-ish | FULL (upsert) |
| sync-crs | 0 7 * * 1 | CRS reports weekly-ish | incremental |
| sync-grants | 30 7 * * 1 | Grant postings | incremental |
| sync-openstates | 0 8 * * 1 | State bills | incremental --since |
| sync-sec-edgar | 30 8 * * 1 | Filings (defense primes) | incremental (upsert) |
| sync-peo-rosters | 0 9 * * 2 | PEO rosters change slowly | FULL (upsert) |
| sync-dod-orgcharts | 30 9 * * 2 | Org charts slow | FULL |
| sync-dod-press-personnel | 0 10 * * 2 | Press releases | incremental |
| extract-press-personnel | 30 10 * * 2 | ⚙️ after press sync | incremental --since |
| extract-gao-interviewees | 0 11 * * 2 | ⚙️ after sync-gao | incremental --since |
| extract-hearing-witnesses | 30 11 * * 2 | ⚙️ after sync-hearings | incremental --since |
| sync-sam-personnel | 0 12 * * 2 | SAM solicitations | incremental --since |

## TIER 3 — MONTHLY 🟣 (reference/economic, rarely changes)
| Job | Cron (UTC) | Why monthly | Mode |
|-----|-----------|-----------|------|
| sync-bea | 0 4 1 * * | BEA economic series monthly | FULL (upsert) |
| sync-bls | 30 4 1 * * | BLS series monthly | FULL (upsert) |
| sync-census | 0 5 1 * * | District/demographic refs annual-ish | FULL (upsert) |
| sync-openspending | 30 5 1 * * | Agency/contractor/industry refs | FULL (upsert) |
| sync-cpe-roster | 0 6 1 * * | CPE roster | FULL |
| import-dow-directory | 30 6 1 * * | Stanford DoW directory | FULL |
| sync-lobby-trending | 0 7 1 * * | Trending topics recompute | FULL |

## TIER 4 — SEASONAL / MANUAL 🟠 (Program Element budget cycle, needs PDF artifacts)
These run on the appropriations calendar and REQUIRE committed offline PDF-extraction artifacts.
NOT pure schedules — gate on artifact availability.
| Job | Window | Trigger |
|-----|--------|---------|
| sync-jbook-r2 / sync-comptroller-jbooks | Mar–May (PB release) | manual + monthly check |
| parse-hasc-report / parse-sasc-report | Jun–Jul (committee markups) | on artifact commit |
| parse-hac-d-report / parse-sac-d-report | Jul–Sep (approps markups) | on artifact commit |
| parse-ndaa-conference | Nov–Jan (conference) | on artifact commit |
| parse-defense-approps-public-law | Dec–Mar (enactment) | on artifact commit |
| parse-pdoc | Mar–May (procurement docs) | on artifact commit |
| recompute-conference-probability | after any PE-year write | ⚙️ daily 🟢 (cheap, recompute) |

## TIER 5 — DERIVED / EMITTERS ⚙️ (DAILY, AFTER sources)
Run after Tier 1 each day so the intel inbox + dashboards reflect the day's ingest.
| Job | Cron (UTC) | Depends on |
|-----|-----------|-----------|
| extract-bill-pe-codes | 0 9 * * * | sync-congress |
| refresh-lobby-intel-mv | 30 9 * * * | sync-lda, sync-openlobby |
| emit-changes | 0 10 * * * | all Tier-1 sources |
| emit-bill-alerts | 20 10 * * * | sync-congress, extract-bill-pe-codes |
| check-comment-periods | 40 10 * * * | sync-regulations |
| compute-health-scores | 0 11 * * * | emit-changes |
| generate-briefings | 30 11 * * * | emit-changes, compute-health-scores |
| recompute-conference-probability | 50 11 * * * | PE-year tables |

## TIER 6 — EMBEDDINGS (DAILY, LAST) 🟢⚙️
Autonomous, content-hash idempotent (only embeds new/changed text), per-tenant.
| Job | Cron (UTC) | Depends on |
|-----|-----------|-----------|
| embed-backfill --source all | 0 13 * * * | sync-congress (bills), sync-lda (lda), capability writes |

## Daily timeline (UTC) at a glance
06:00 federal sources → 07:00 money/awards → 08:00 enrich →
09:00 bill-PE + MV → 10:00 emit-changes/alerts → 11:00 health/briefings/conf-prob →
13:00 embeddings. Weekly/monthly stacked on early-morning low-traffic slots on their days.

## Concurrency rule
One running instance per job (no overlap). If a daily run is still going when the next fires, skip.
Enforced via the ScheduledJob construct + SyncRun status='running' guard.
