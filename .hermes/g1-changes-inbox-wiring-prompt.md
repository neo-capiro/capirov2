Task: Implement G-001 (G1) for Client Intel v1 snapshot destination wiring.

Scope:
- apps/web/src/pages/clients/intelligence-v1/components/BriefingCard.tsx
- apps/web/src/pages/clients/intelligence-v1/components/TopAlertsList.tsx

Acceptance:
- Briefing CTA routes to client-filtered Changes Inbox.
- Top Alerts header CTA and alert row click route to client-filtered Changes Inbox.
- Do not break other links/actions.

Constraints:
- Prefer links.viewAllHref / briefing cta fallback that already includes clientId.
- If an alert row has its own href that is not client-filtered, do NOT lose client filter.
- Keep changes minimal and production-safe.

After code changes, run:
- pnpm --filter @capiro/web typecheck
- pnpm --filter @capiro/api typecheck

Return concise change summary and acceptance mapping.