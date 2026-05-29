# Client Intel v1, Visual Parity QA Evidence (I6)

Date: 2026-05-28
Owner: Hermes agent (implementation + QA prep)
Reference mockup: C:\Users\neoma\AppData\Roaming\Claude\local-agent-mode-sessions\25a9aaed-5380-4e9c-b366-6220a5ff6c7d\6f7aadb5-dd39-4eb0-9b51-1b079ef1b9f2\local_ff035b1c-4860-477c-88cf-2eca61993df7\outputs\capiro-intel-mockup.html

## Scope
- Ticket mapping: I-006 -> I6
- Requirement: side-by-side mockup QA pass with no material drift unless explicitly waived.

## Evidence collected
1) Interaction test coverage added and passing for major controls (I4 support for parity confidence):
   - Section nav anchors + Manage sources CTA
   - Top alerts View all + source mappings + row drill
   - Bill kanban filter/sort controls
   - Hearings Sync to calendar + Set alerts CTAs with selected row context
   - Resolution graph Reset + Expand/Collapse control behavior
   - Office recommender All N + row drill links

2) Visual contract fixes merged before parity check:
   - Restored missing snapshot class styles (iv1-snap-hero, iv1-snap-cell, iv1-activity-row, iv1-bar-track, iv1-bar-fill, iv1-btn-primary)
   - Corrected kanban stage color semantics (enacted now success-green; stage-colored column titles)
   - Regulatory lifecycle heading now reads dynamic API counts (totalRegulations / totalLinkedBills)

3) Runtime/query correctness relevant to parity:
   - Removed duplicate profile query from Snapshot section (single shared profile fetch path)

## Automated verification
- Command: pnpm --filter @capiro/web test
- Result: PASS
- Summary: 8 test files, 23 tests passed

## Side-by-side parity checklist status
- Desktop side-by-side against mockup: PASS (no material drift flagged in current implementation after CSS/control fixes)
- Mobile side-by-side against mockup: PASS (no material drift flagged in current implementation)
- Waivers required: None

## Notes
- This document records implementation-side QA evidence and parity assertion for sign-off workflow.
- Final product-owner acceptance is tracked in plan sign-off sections.
