Task: Implement production-ready freshness + unresolved metadata + scoping guarantees for Client Profile v1.

Target file:
- apps/api/src/intelligence/intelligence.service.ts

Acceptance criteria:
1) profile-v1 payload includes stable freshness metadata using generatedAt and sourceCount.
2) profile-v1 payload includes unresolvedMappings metadata.
3) tenant/client scoping guarantees are explicit and correct for all data used by getClientProfileV1.

Implementation guidance:
- Read getClientProfileV1 and any helper it calls that can break tenant scoping.
- Add metadata under top-level meta (do not break existing fields):
  - generatedAt (ISO, same as top-level generatedAt)
  - sourceCount (count of mapped/active intel sources used for this client profile)
  - unresolvedMappings (count of unresolved mappings for this client in-tenant)
- Ensure mapping reads in profile-v1 path are tenant-scoped via withTenant or equivalent safe scope.
- Ensure ex-staffer path used by profile-v1 is tenant/client-scoped (no cross-tenant leakage).
- Keep API contract backward-compatible (additive only).
- Run and report:
  - pnpm --filter @capiro/api typecheck
  - pnpm --filter @capiro/web typecheck

Output:
- changed files
- acceptance mapping
- any backend contract notes