# Phase 1.5 Acceptance Gate Report

Generated: 2026-05-30T01:03:01.801098Z

## Gate metrics
- Total personnel records imported: 3544
- Total PE records imported: 870
- Merge queue entries: 0 (open: 0)
- Quarantine count (acquisition_personnel_quarantine): 0
- Program element quarantine count: 1662
- No actual emails in DB (email_domain contains @): 0 rows

## 5 sample PE coverage (data-plane)
pe_code,title,personnel_count
0602303E,Information & Communications Technology,19
0602715E,Materials and Biological Technology,12
0602785A,Manpower/Personnel/Training Technology,10
0604134A,Counter Improvised-Threat Demonstration, Prototype Development, and Testing,10
0604182A,Hypersonics,10

## UI verification status
- PE Watch routes load but render blank shell in this environment (`#root` present with 0 children).
- Could not interact with Program Team panel or Link button due blank shell.
- /admin/acquisition-personnel/merge-queue also renders blank shell in browser.

## Staleness audit
- stale_120d: 3544/3544 (100.00%)
- Updated 5 stale rows to status=unknown as sanity action.
- IntelligenceChange flow check after update: no new rows in last 15 minutes (not confirmed).

## Spot-check accuracy (10 sampled publicProfileUrl records)
- Reachability outcomes: many URLs blocked by authwalls/Access Denied or non-profile landing pages.
- Evaluated subset with determinable outcome: 4/10
- Strict accuracy (exact name+title+org match): 0/4 = 0.0%
- Lenient accuracy (count partial matches): 1/4 = 25.0%
- Result does not meet ≥80% threshold based on determinable sample in this run.

## Build/Test checks
- pnpm --filter @capiro/api test: FAIL (2 suites failed, 47 tests failed)
- pnpm --filter @capiro/web test: PASS
- pnpm --filter @capiro/web typecheck: PASS
- pnpm --filter @capiro/api exec tsc --noEmit: PASS in this run

## Lighthouse
- Could not run: lighthouse CLI unavailable in environment (`Command "lighthouse" not found`).
- Also blocked by blank-shell runtime, so populated PE Watch perf could not be measured.

## Recommendation
- Recommendation: FIX-FIRST (NO-GO to Phase 2).
- Fix-first list:
  1) Resolve blank-shell frontend runtime (auth/bootstrap/render path) so PE Watch and admin page are interactable.
  2) Restore green API test baseline (2 failing suites / 47 failing tests).
  3) Implement/verify IntelligenceChange emission for personnel status transitions if required by Step 13 expectations.
  4) Improve profile-url quality/normalization (remove mailto/non-profile links) before using as accuracy KPI.
  5) Install/enable Lighthouse CLI or alternate perf harness for budget validation.