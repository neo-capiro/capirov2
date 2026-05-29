Task: Implement G-003 (G3) production-ready issue leaderboard deep-links for Client Intel v1.

Goal:
- Capability/issue tags and relationship issue CTAs route correctly to Issue Leaderboard page route:
  /intelligence/issues/:code
- No broken /intelligence/issues (without :code) navigation remains in the v1 sections path.

Scope:
- apps/web/src/pages/clients/intelligence-v1/sections/*
- If needed for robust linking, adjust backend profile-v1 links in:
  apps/api/src/intelligence/intelligence.service.ts

Current context:
- App route exists only for /intelligence/issues/:code (IssueLeaderboardPage).
- Current profile-v1 link competitorIssuePage returns '/intelligence/issues' (missing :code).
- RelationshipsSection currently uses issueHref for All/row/node links and can produce '/intelligence/issues?...' (broken).

Required behavior:
1) Determine a canonical issue code for this client from aggregate data (prefer legislativeRegulatory.kanban.issueCodes[0], then snapshot/capability-derived fallback if present).
2) Build issue leaderboard href as /intelligence/issues/<code> when code exists.
3) In sections, route capability/issue related links to that href.
4) If no code exists, disable those issue-specific links safely (no broken path).
5) Keep changes minimal and type-safe.

Backend check:
- Ensure profile-v1 links include a code-specific competitorIssuePage when issue code is available.
- Maintain tenant/client scoping and stable contract.

Acceptance criteria:
- capability/issue tags route correctly to /intelligence/issues/:code.
- no v1 section CTA routes to bare /intelligence/issues.
- web and api typecheck pass.

After edits run:
- pnpm --filter @capiro/web typecheck
- pnpm --filter @capiro/api typecheck

Output:
- concise changed files list + acceptance mapping.