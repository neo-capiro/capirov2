B-003 (B3) — Production-ready Briefing Card (frontend + backend)

Context:
- Repo: C:\Users\neoma\OneDrive\Documents\Claude\Projects\capirov2\git\capirov2
- Existing host: apps/web/src/pages/clients/intelligence-v1/sections/SnapshotSection.tsx
- Existing aggregate API: apps/api/src/intelligence/intelligence.service.ts -> getClientProfileV1(...)
- Current snapshot has inline "Clio briefing" markup. Replace this with a reusable component and backend-enriched payload.
- Mock for visual target: C:/Users/neoma/AppData/Roaming/Claude/local-agent-mode-sessions/25a9aaed-5380-4e9c-b366-6220a5ff6c7d/6f7aadb5-dd39-4eb0-9b51-1b079ef1b9f2/local_ff035b1c-4860-477c-88cf-2eca61993df7/outputs/capiro-intel-mockup.html

Goal:
Implement ticket B-003 end-to-end and production-ready:
- Briefing card with highlights + generated date + event footer + "See all changes" CTA.
- Ensure backend exposes the briefing payload needed by the card.
- Ensure frontend consumes the payload and gracefully falls back when briefing content is absent.

Required file targets:
1) apps/web/src/pages/clients/intelligence-v1/components/BriefingCard.tsx (create)
2) apps/api/src/intelligence/intelligence.service.ts (update aggregate payload)
Plus any required type updates (e.g., mappers.ts, SnapshotSection.tsx, theme.css) to compile cleanly.

Acceptance criteria (must all pass):
1. Summary is functional:
   - Card renders briefing summary text from aggregate payload when available.
   - If absent, SnapshotSection fallback text still renders.
2. Highlights are functional:
   - Card displays explicit highlight chips/inline emphasis for key items (amounts, deadlines, major counts/events) from payload.
   - If no highlights are returned, card still renders without visual break.
3. Generated date is functional:
   - Card shows generated timestamp/date sourced from backend payload (not hardcoded "now" only).
4. Event footer is functional:
   - Card footer shows event count (e.g., events this week / in window) using backend payload.
5. CTA is functional:
   - "See all changes" links to aggregate.links.changesInbox when present, else /intelligence/changes.
6. Type-safe and compile-clean:
   - API and web typechecks must pass.

Implementation notes:
- Keep the v1 section order and existing architecture intact.
- Do not add new chart deps.
- Respect moved-out model: changes inbox is global page; card CTA deep-links there.
- Keep styles scoped using existing iv1-* conventions.
- Keep backend null-safe with deterministic defaults.

Suggested payload shape under sections.snapshot (you may refine if needed, but preserve semantics):
- dailyBriefing: {
    summary: string | null,
    highlights: Array<{ label: string; value?: string | number | null; tone?: 'critical'|'notable'|'info'|'neutral' }>,
    generatedAt: string,
    eventCount: number,
    ctaHref?: string
  }
If introducing this object, update all frontend mappings and consumers accordingly.

Backend requirements:
- Build dailyBriefing object from existing available data in getClientProfileV1:
  - summary from profile.aiSummary (with safe fallback strategy)
  - highlights derived from existing data already loaded there (topAlerts, roi/lobbying, deadlines, tracked bills, changes count, etc.)
  - generatedAt from server-side generation timestamp
  - eventCount from relevant change count window
  - ctaHref from links.changesInbox
- Ensure response remains backward-compatible enough for current Snapshot rendering path.

Frontend requirements:
- Create reusable BriefingCard.tsx component that accepts structured dailyBriefing object + fallback text + CTA href.
- Replace inline briefing block in SnapshotSection with BriefingCard usage.
- Preserve avatar/badge visual language aligned to mock.
- Footer must include event count + CTA.

Verification commands to run before finishing:
- pnpm --filter @capiro/api typecheck
- pnpm --filter @capiro/web typecheck

Output expectations:
- Make code changes directly.
- At end, provide concise summary of files changed and exactly how each acceptance criterion is satisfied.
