# Capiro Ingestion Pipeline — Deep Analysis
Generated read-only from `main` (commit 7a0c0a7). No DB connection; this is a CODE + INFRA analysis.

================================================================
## TL;DR — THE ROOT CAUSE
================================================================
Your tables are empty because **NOTHING SCHEDULES THE INGESTION SCRIPTS TO RUN.**

- 64 scripts exist on main; ~45 are real data-ingestion jobs wired into `entrypoint.sh`.
- `entrypoint.sh` is ONLY a dispatch table — it maps a kebab-case command to a script.
  Its own comment says "EventBridge can dispatch each as a one-off ECS task."
- BUT there are **ZERO EventBridge rules, ZERO scheduled ECS/Fargate tasks, ZERO cron
  definitions** anywhere:
    * CDK infra (`infra/cdk/lib/*`): no `events.Rule`, no `Schedule.cron/rate`,
      no `ScheduledFargateTask`. (Confirmed by grep.)
    * GitHub Actions: only `api-image.yml` / `web-image.yml` (image builds). No `schedule:`/`cron:`.
    * In-app: no NestJS `@Cron` / `ScheduleModule` / `@Interval`.
- Therefore every sync runs ONLY if a human manually launches an ECS task (or runs it
  locally). If nobody has, the source tables are empty -> blank panels everywhere
  (FEC, bills, district nexus, program elements, hearings, etc.).

The code is complete and correct. The MISSING PIECE is the scheduler/orchestration layer.

================================================================
## WHAT POPULATES WHAT  (script -> table, verified)
================================================================
Each is invoked as:  `<container> <kebab-command>`  (one-off ECS task) or local `tsx`.

FEDERAL / LEGISLATIVE INTEL
  sync-congress          -> congress_bill (+action/committee/subject)      [GOVINFO_API_KEY]
  sync-federal-register  -> federal_register_document
  sync-regulations       -> regulatory_docket            (raw SQL insert)
  sync-hearings          -> committee_hearing             [logs SyncRun]
  sync-gao               -> gao_report
  sync-crs               -> crs_report
  sync-openstates        -> state_bill, state_legislator
  extract-bill-pe-codes  -> (links bills<->PEs via writer)

MONEY / INFLUENCE
  sync-fec               -> fec_committee, fec_contribution
  sync-fec-pac           -> fec_pac_contribution
  sync-fara              -> fara_registration
  sync-lda               -> lda_client/contribution/filing/gov_entity/issue_code/lobbyist/registrant
  sync-openlobby         -> lobby_intel, lobby_issue_ref, lobby_trending_topic
  sync-lobby-trending    -> lobby_trending_topic
  refresh-lobby-intel-mv -> (REFRESH MATERIALIZED VIEW)
  sync-sec-edgar         -> sec_filing

FEDERAL SPENDING / AWARDS
  sync-federal-award     -> federal_award                 [logs SyncRun]
  enrich-award-districts -> federal_award (district enrich)
  sync-grants            -> federal_grant
  sync-openspending      -> federal_agency, federal_contractor, federal_industry

ECONOMIC INDICATORS
  sync-bea               -> bea_data
  sync-bls               -> bls_data_point, bls_series
  sync-census            -> census_district

PROGRAM ELEMENTS (defense budget) — mostly OFFLINE-ARTIFACT parsers via ProgramElementWriterService
  sync-jbook-r2          -> program_element, program_element_project, program_element_source
  sync-comptroller-jbooks-> program_element_source
  parse-hasc-sasc-reports-> program_element_year (HASC/SASC marks)         [needs PDF artifact]
  parse-defense-approps-reports -> program_element_year (HAC-D/SAC-D)      [needs PDF artifact]
  parse-ndaa-conference  -> program_element_year (conference)              [needs PDF artifact]
  parse-defense-approps-public-law -> program_element_year (enacted)       [needs PDF artifact]
  parse-pdoc-army        -> program_element + procurement_line             [needs PDF artifact]
  recompute-conference-probability -> conference_probability (raw SQL)
  seed-program-element-fixtures -> PE fixtures (DEV ONLY)

PERSONNEL / DIRECTORY
  sync-peo-rosters       -> acquisition_personnel, acquisition_personnel_source
  sync-sam-personnel     -> (SAM solicitation personnel)  [SAM_GOV_API_KEY] [logs SyncRun]
  sync-dod-press-personnel / extract-personnel-from-press-releases -> personnel [logs SyncRun]
  sync-dod-orgcharts / sync-cpe-roster -> org-chart personnel
  extract-gao-interviewees / extract-hearing-witnesses -> personnel        [logs SyncRun]
  generate-pe-person-candidates -> program_element_person_candidate
  sync-entity-resolution -> (resolves/merges personnel)
  import-stanford-dow-directory / parse-dow-directory -> DoW directory

NEWS / MISC INTEL
  sync-rss-intel         -> intel_article

DERIVED / EMITTERS (run AFTER syncs; depend on source tables being populated)
  emit-changes           -> intelligence_change           [logs SyncRun]
  emit-bill-alerts       -> intelligence_change (per-bill stage alerts)
  emit-clio-alerts       -> clio_proactive_alert
  generate-briefings     -> intelligence_insight
  compute-health-scores  -> intelligence_change, intelligence_insight
  check-comment-periods  -> intelligence_change
  backfill-sector-tags   -> client, client_capability
  embed-backfill         -> context_embedding (vector embeddings; --source bills|lda|capabilities)

BOOTSTRAP / ADMIN (one-shot, not data ingestion)
  migrate (prisma migrate deploy + seed-workflows), bootstrap-tenant,
  bootstrap-capiro-admin, bootstrap-roles, seed-outreach-ai-templates, delete-tenant

================================================================
## SCHEDULES
================================================================
CURRENT STATE: NONE. There is no automation. Every job above is manual-only.

The only thing that runs automatically is the `migrate` task on deploy (prisma
migrate deploy + idempotent workflow-template seed) — that's schema + workflow
catalog, NOT data ingestion.

Implied cadence (from code comments, NOT implemented):
  - Most federal syncs: intended daily/weekly.
  - PE conference parsers: "scheduled primarily Nov-Jan" (NDAA/approps window).
  - emit-* / compute-* : intended to run AFTER the source syncs each cycle.

================================================================
## WHAT'S (LIKELY) NOT INGESTED  — and WHY
================================================================
Because nothing is scheduled, assume EVERYTHING source-side is empty unless someone
ran it by hand. In priority order for the lobbyist-facing UI:

1. CONGRESS BILLS  (sync-congress) — your Clio screenshot showed "0 results" for
   defense-approps bills. congress_bill is empty -> bills pipeline blank, bill alerts
   never fire, bill<->PE links empty. NEEDS GOVINFO_API_KEY + a run.
2. FEC  (sync-fec, sync-fec-pac) — fec_contribution/fec_pac_contribution empty ->
   member FEC panel shows $0. ALSO requires confirmed `client_intel_mapping`
   rows (source='fec_employer') to attribute to clients.
3. PROGRAM ELEMENTS — the parsers need committed PDF-extraction ARTIFACTS as input
   (offline pdfplumber rows). If artifacts/run missing, program_element_year marks
   (HASC/SASC/conference/enacted) are empty -> PE detail panels blank, conference
   probability has nothing to train on.
4. DISTRICT NEXUS — depends on federal_award (sync-federal-award + enrich-award-districts)
   AND census_district (sync-census). Both manual.
5. HEARINGS / GAO / CRS / FARA / SEC / LDA / state bills / economic indicators —
   all manual, all likely empty.
6. PERSONNEL (DoW directory) — multiple sources, all manual.

DATA MODELS WITH NO BULK INGEST WRITER (populated only by user action / derived):
  ProgramElementWatch (user clicks "watch"), DirectoryContactNote/Favorite (user),
  ClioConversation/Message/Note/Memory (chat runtime), Meeting*/Mail* (MS Graph sync),
  EngagementCampaign/Contact (user), Strategy/Workflow* (user/seed). These are EXPECTED
  to be empty until used — not a pipeline gap.

================================================================
## EXTERNAL DEPENDENCIES / KEYS (gating ingestion)
================================================================
  GOVINFO_API_KEY   -> sync-congress, GovInfo-backed PE/bill flows
  SAM_GOV_API_KEY   -> sync-sam-personnel
  OPENAI_API_KEY / ANTHROPIC_API_KEY -> embeddings (embed-backfill), Clio, briefings
  CLERK_*           -> auth (not ingestion)
  MICROSOFT_*       -> engagement (Meetings/Mail via Graph), not federal ingest
  (FEC/FARA/FedRegister/GAO/CRS/OpenStates/BEA/BLS/Census/Grants — mostly open APIs,
   verify per-script whether a key/env is required; several use public endpoints.)
  Firecrawl (FIRECRAWL_API_KEY) — used to FIND .mil J-book/orgchart URLs (per ops notes).

================================================================
## OBSERVABILITY GAP
================================================================
Only 6 scripts write the SyncRun table (emit-changes, sync-federal-award,
sync-sam-personnel, extract-gao-interviewees, extract-hearing-witnesses,
extract-personnel-from-press-releases). The other ~40 syncs DON'T log runs, so
there's no record of when/if they last populated anything. Recommend: wrap every
sync in a SyncRun start/finish/row-count record for a real ingestion dashboard.

================================================================
## RECOMMENDED FIX (the missing layer)
================================================================
A. Add a scheduler. Either:
   - CDK: EventBridge Rules -> ScheduledFargateTask per sync (command override =
     the kebab name already in entrypoint.sh). Wire cadences (daily federal syncs,
     post-sync emit-* fan-out, Nov-Jan PE parsers). This is the intended design.
   - OR a lightweight Nest @Cron ScheduleModule inside the API for the lighter syncs.
B. First MANUAL backfill pass (decide order): migrate -> sync-congress -> sync-fec(+pac)
   -> sync-federal-award -> enrich-award-districts -> sync-census -> sync-lda ->
   sync-hearings/gao/crs -> PE parsers (with artifacts) -> emit-changes ->
   compute-health-scores -> generate-briefings -> embed-backfill.
C. Confirm required API keys exist as secrets in the target env (GOVINFO_API_KEY,
   SAM_GOV_API_KEY, OPENAI/ANTHROPIC).
D. Add SyncRun logging to all syncs for visibility.

NOTE: per ops constraints, do NOT `cdk deploy Compute` blindly (live drift). Any
scheduler infra must be reconciled with the live stack first, or added out-of-band.
