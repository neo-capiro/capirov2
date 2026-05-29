Implement Epic A follow-up for Client Intelligence v1 in this repo.

Current state:
- A-001 baseline already exists:
  - apps/web/src/pages/clients/IntelligenceTab.tsx renders ClientIntelV1Page.
  - apps/web/src/pages/clients/intelligence-v1/ClientIntelV1Page.tsx contains 4 anchored sections.

Now implement A-002, A-003, A-004, A-005 with minimal safe diffs.

Requirements:
1) Scaffold intelligence-v1 module structure under:
   apps/web/src/pages/clients/intelligence-v1/
   - components/SectionNav.tsx
   - sections/SnapshotSection.tsx
   - sections/FinancialFootprintSection.tsx
   - sections/LegislativeRegulatorySection.tsx
   - sections/RelationshipsSection.tsx
   - mappers.ts
   - (keep ClientIntelV1Page.tsx as host)

2) ClientIntelV1Page should compose the above section components in exact order:
   - Snapshot
   - Financial Footprint
   - Legislative & Regulatory
   - Relationships
   Keep sticky left anchor nav with active-section highlight while scrolling.

3) Remove/avoid duplicates of moved-out standalone experiences in this host.
   Do not add standalone graph tab, ex-staffer standalone card, standalone bill tracker card, or standalone comment-alert card.

4) Wire moved-out links / actions (no dead anchors):
   - Changes inbox link: /intelligence/changes?clientId=<id>
   - Manage sources link: /settings/intelligence-mappings
   - Issue leaderboard example links can route to /intelligence/issues/:code if present, else disable intentionally.
   - Bill detail fallback should go to /explorer if dedicated bill detail path not guaranteed.
   Any visible action without destination must be explicitly disabled.

5) A-004 nav metadata:
   - Add simple nav metadata in SectionNav from mappers output:
     generatedAt (relative or formatted)
     sourceCount (number)
   - Use a mapper in mappers.ts that derives these values from available clientId/clientName + safe defaults.
   No backend change required for this step.

6) A-005 visual parity pass (lightweight):
   - Add focused styles in apps/web/src/theme.css for intelligence-v1 classes only.
   - Improve composition/hierarchy/spacing/typography/control placement to resemble mockup structure.
   - Do not introduce new chart libraries.

Mockup reference (local):
C:/Users/neoma/AppData/Roaming/Claude/local-agent-mode-sessions/25a9aaed-5380-4e9c-b366-6220a5ff6c7d/6f7aadb5-dd39-4eb0-9b51-1b079ef1b9f2/local_ff035b1c-4860-477c-88cf-2eca61993df7/outputs/capiro-intel-mockup.html

Important constraints:
- Keep changes FE-only for this task.
- Do not edit unrelated modules.
- Do not commit.

After edits:
- Run: pnpm --filter @capiro/web typecheck
- Fix any TS errors.

Output:
- List changed files.
- Mark A-002..A-005 as done/partial with short notes.
