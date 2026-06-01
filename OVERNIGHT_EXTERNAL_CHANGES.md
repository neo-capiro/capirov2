# Morning checklist — external changes for Neo — 2026-05-31

Every change required outside the codebase. Format: **what** — _where_ — why — blocking?

## Env vars / secrets
All new flags ship with safe defaults in `config.schema.ts` + are documented in `.env.example`, so
**none are blocking** — Clio works unchanged without setting any of them. Optionally set in AWS Secrets
Manager to toggle behavior:
- `CLIO_PROMPT_CACHE_ENABLED` (P0-1) — default `true`. Set `false` to disable Anthropic prompt caching.
- `CLIO_TOOL_TIMEOUT_MS` (P0-2) — default `20000`. Per-tool execution timeout (ms).
- `CLIO_CITATIONS_ENABLED` (P0-3) — default `true`. Set `false` to disable inline citations.
- (No new flag for P0-4; Stop uses request lifecycle.)
- Confirm `ANTHROPIC_API_KEY` is set in the API task's secrets (it was undocumented in `.env.example`;
  I added it). Clio's chat brain requires it.

## Tooling (recommended, not blocking)
- **Install + configure ESLint** across the monorepo, or remove the dead `lint` scripts. Currently
  `pnpm lint` always fails because `eslint` isn't installed. — _repo root + apps/api + apps/web_ —
  so the lint gate is real. Not blocking overnight work (typecheck+tests used instead).
- **Rotate the GitHub PAT** found in `.git/config` `origin` URL and switch to a credential helper. —
  _local git config (synced via OneDrive)_ — secret hygiene. Not blocking.

## Infra / IAM / DNS / vendor accounts
- _(none so far)_
