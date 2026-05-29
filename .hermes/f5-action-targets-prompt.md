Task: Implement F-005 (F5) in production-ready form.

Goal
Add action-target metadata in profile-v1 payload so frontend visible CTAs can be wired safely without guessing URLs/params.

File to edit:
- apps/api/src/intelligence/intelligence.service.ts

Acceptance:
- Payload includes targets + params required by visible controls across sections.
- Additive only (backward compatible with existing links/sections contract).
- Keep tenant/client-safe scoping (no cross-tenant leakage).

Visible controls to support:
- Snapshot: See all changes / View all alerts / mappings help
- Financial: Run FEC enrichment CTA / district support CTA
- Legislative: bill drill, sync calendar, set alerts
- Relationships: office all-N, office row drill, graph node drill

Implementation guidance:
- Add a top-level object (e.g. actionTargets) with stable keys and explicit route + params.
- Also include safe prebuilt link variants where useful (optional) but do not remove existing links keys.
- Ensure params include clientId where needed and placeholders for dynamic params (e.g. bill identifier, office slug/name, graph node id).

Then run:
- pnpm --filter @capiro/api typecheck
- pnpm --filter @capiro/web typecheck

Return concise summary with acceptance mapping.