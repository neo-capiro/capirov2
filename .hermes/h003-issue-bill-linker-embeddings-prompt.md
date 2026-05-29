Task: Implement H-003 -> H3 (Issue-Bill Linker embeddings migration) production-ready, API-only, no UI regressions.

Scope:
- Files under apps/api/src/intelligence/**/*.ts (plus module wiring in apps/api/src if needed).
- Do not change web UI contracts; preserve return payload shape for tracked bills and kanban consumers.
- Migrate matching source from keyword/subject overlap to embeddings-backed retrieval where available.
- Keep deterministic fallback to current keyword logic if embeddings unavailable/empty/error.

Current state clues:
- IntelligenceService currently uses keyword matching in:
  - private findRelevantBills(issueCodes, fallbackTerms)
  - async getTrackedBills(clientId, tenantId?)
- Context embeddings infra exists:
  - table context_embeddings (sourceType includes 'bill' from sync/backfill scripts)
  - embedder.ts has buildBillText and bill rows are embedded via sync-congress/embed-backfill.
- Need migration without UI breakage.

Implementation requirements:
1) Add/extend an internal embeddings bill linker in intelligence service layer:
   - New helper that:
     a) resolves issue/fallback terms text (same semantic inputs as keyword matcher)
     b) embeds query text (prefer existing embedding pipeline/provider style used in repo)
     c) searches context_embeddings for source_type='bill' via cosine similarity
     d) joins back to congress_bill for full fields
   - Must safely handle: missing embedding provider/config, query embed failure, no vectors in DB, SQL errors.

2) Preserve response contract:
   - findRelevantBills() return shape unchanged.
   - getTrackedBills() return shape unchanged.
   - Ordering should remain sensible (similarity desc then latest action date desc) but output keys unchanged.

3) Controlled migration behavior:
   - Use embeddings-first path for bill matching.
   - If embeddings path cannot provide usable bill IDs, transparently fallback to existing keyword matcher.
   - Add lightweight metadata (internal only/logging) if helpful, but DO NOT require UI changes.

4) Performance/safety:
   - Limit candidate set from vector search before join (e.g., top 100/150).
   - Deduplicate IDs.
   - Keep existing LIMIT behavior at API output layer (e.g., 25 in findRelevantBills, 50 in getTrackedBills) unless already defined.
   - Avoid N+1 queries.

5) Module wiring:
   - If adding EmbeddingsService dependency to IntelligenceService, update IntelligenceModule imports/providers correctly.

6) Acceptance checks in your output:
   - Mention exact files changed.
   - Confirm payload shape unchanged for tracked bills endpoints.
   - Run and report:
     - pnpm --filter @capiro/api typecheck
     - pnpm --filter @capiro/web typecheck

Important:
- This must be production-ready end-to-end.
- Do not leave partial scaffolding.
- If migration cannot be completed, stop and output exact blocker and fallback state.
