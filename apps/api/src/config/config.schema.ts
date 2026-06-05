import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_BIND_HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),

  CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY is required'),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1, 'CLERK_WEBHOOK_SIGNING_SECRET is required'),
  CLERK_JWT_ISSUER: z.string().url().optional(),

  WEB_ORIGIN: z.string().optional(),

  // Tenant assets bucket (logos, future documents).
  ASSETS_BUCKET: z.string().optional(),
  DIRECTORY_S3_BUCKET: z.string().optional(),
  DIRECTORY_S3_PREFIX: z.string().optional(),
  AWS_REGION_DEFAULT: z.string().default('us-east-1'),

  // Optional AI providers. Meeting prep endpoints fail closed with 503 until
  // one provider key is configured; they never return canned prep.
  AI_PROVIDER: z.enum(['openai', 'anthropic']).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),

  // SAM.gov Contract Opportunities API key (api.data.gov). Stored in Secrets
  // Manager and injected as an env var; optional so non-prod boots without it.
  SAM_GOV_API_KEY: z.string().optional(),

  // Clio chat brain (single Anthropic-native model + budgets). Env-driven so
  // the model and token ceiling are not hard-coded in service code.
  CLIO_MODEL: z.string().default('claude-sonnet-4-6'),
  CLIO_MAX_TOKENS: z.coerce.number().int().positive().default(4000),
  CLIO_INTENT_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  CLIO_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  // Max characters of prior conversation history sent to the model. Older turns
  // beyond this budget are dropped (oldest-first) to avoid silent context-limit
  // 400s on long sessions.
  CLIO_HISTORY_CHAR_BUDGET: z.coerce.number().int().positive().default(24_000),
  // Max agentic tool-use rounds per message before forcing a final answer (P2-3).
  CLIO_MAX_TOOL_ROUNDS: z.coerce.number().int().positive().default(8),
  // Wall-clock budget for a whole turn across all rounds (P2-3). When exceeded the
  // loop stops and wraps up gracefully. <= 0 disables. Keep <= the request timeout.
  CLIO_TURN_BUDGET_MS: z.coerce.number().int().min(0).default(90_000),
  // Anthropic prompt caching (P0-1). When enabled, cache breakpoints are placed
  // on the static system base and the tool-schema block, so repeated turns within
  // the ~5-minute cache TTL reuse that prefix (response usage reports
  // cache_read_input_tokens > 0). Only the static prefix is cached; per-turn
  // context and messages are never cached. Set false/0/no/off to disable.
  CLIO_PROMPT_CACHE_ENABLED: z
    .string()
    .default('true')
    .transform((v) => !['false', '0', 'no', 'off'].includes(v.trim().toLowerCase())),
  // Per-tool execution timeout (P0-2). Within an agentic round, read-only tools
  // run concurrently and side-effecting tools serially; each tool call is bounded
  // by this timeout. On timeout the model receives an error tool_result and the
  // turn proceeds (the tool is not hard-aborted).
  CLIO_TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  // Max retries for idempotent (read-only) Clio tools; side-effecting tools never
  // retry. After repeated failures a per-(tenant, tool) circuit breaker pauses the
  // tool so the turn proceeds without it instead of retrying a dead dependency (P2-2).
  CLIO_TOOL_RETRIES: z.coerce.number().int().min(0).default(1),
  // Inline citations (P0-3). When enabled, numbered sources are injected into
  // tool results and the model cites them as [N]; hallucinated markers are
  // stripped post-hoc and the used citations are emitted (SSE) + persisted to
  // clio_message.metadata.citations. Set false/0/no/off to disable.
  CLIO_CITATIONS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => !['false', '0', 'no', 'off'].includes(v.trim().toLowerCase())),
  // Skill registry (P0-5). When enabled, migrated intents resolve their guidance
  // + output template from clio/skills/*; un-migrated intents fall back to the
  // legacy inline maps. Migrated skills are byte-identical to the legacy entries,
  // so toggling this never changes output. Set false/0/no/off to force the
  // legacy path.
  CLIO_SKILLS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => !['false', '0', 'no', 'off'].includes(v.trim().toLowerCase())),
  // Grounding/verifier gate (P0-6). When enabled, deliverables (briefings/memos)
  // get a cheap second pass (CLIO_INTENT_MODEL) that flags claims unsupported by
  // retrieved sources; >20% unsupported marks the output low-confidence. Never
  // gates raw chat. Fail-open. Set false/0/no/off to disable.
  CLIO_VERIFIER_ENABLED: z
    .string()
    .default('true')
    .transform((v) => !['false', '0', 'no', 'off'].includes(v.trim().toLowerCase())),
  // Suggested next actions (P2-4): after an answer, a cheap intent-model pass
  // proposes 2-3 follow-up prompts rendered as clickable chips. Fail-open.
  CLIO_SUGGESTIONS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => !['false', '0', 'no', 'off'].includes(v.trim().toLowerCase())),

  // Clio Deep Research (a heavier, multi-round agentic research run that produces
  // a long, cited report artifact). Separate budgets from the chat drawer because
  // research runs longer and writes a much larger output.
  CLIO_RESEARCH_MODEL: z.string().default('claude-sonnet-4-6'),
  CLIO_RESEARCH_PLAN_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  CLIO_RESEARCH_MAX_TOKENS: z.coerce.number().int().positive().default(8000),
  CLIO_RESEARCH_MAX_TOOL_ROUNDS: z.coerce.number().int().positive().default(10),
  // Per-request timeout for the deep-research model calls. A single research
  // turn legitimately runs minutes (gathering across many tools, then streaming
  // an 8k-token report), so the 120s interactive chat timeout
  // (CLIO_REQUEST_TIMEOUT_MS) is far too short — it was aborting research runs
  // before the report was written, leaving only the "Sources consulted" list.
  CLIO_RESEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),

  // 32-byte base64 or hex key used for AES-256-GCM encrypted meeting notes.
  NOTES_ENCRYPTION_KEY: z.string().optional(),
  NOTES_ENCRYPTION_KEY_VERSION: z.string().default('v1'),

  // 32-byte base64 or hex key for AES-256-GCM at-rest encryption of OAuth
  // access/refresh tokens stored in engagement_connection_tokens. Distinct
  // from NOTES_ENCRYPTION_KEY so a key compromise on either side is contained.
  OAUTH_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  OAUTH_TOKEN_ENCRYPTION_KEY_VERSION: z.string().default('v1'),

  // 32+ byte secret used to HMAC-sign the `state` parameter in OAuth flows so
  // a callback can be tied back to the connection that started it.
  OAUTH_STATE_SECRET: z.string().optional(),

  // Microsoft 365 Graph OAuth (capiro-outlook app registration). Cert auth is
  // used because the capiro.ai tenant blocks client secrets. The private key
  // is a PEM string; if it doesn't start with "-----BEGIN" the loader treats
  // it as base64-encoded PEM (handy for env-var transport).
  MICROSOFT_CLIENT_ID: z.string().optional(),
  // MICROSOFT_TENANT_ID is retained for reference/diagnostics only. It must NOT
  // drive the OAuth authority: customers connect their own Outlook mailboxes
  // from ANY Azure AD org, so the authority is multi-tenant (MICROSOFT_AUTHORITY
  // below). Pinning the authority to this single tenant GUID (= the capiro.ai
  // tenant) was what rejected every external customer with AADSTS50020.
  MICROSOFT_TENANT_ID: z.string().optional(),
  // OAuth authority for the Microsoft 365 integration. Defaults to the shared
  // multi-tenant `/organizations` endpoint so work/school accounts from any
  // customer Azure AD tenant can connect. The capiro-outlook app registration
  // is already multi-tenant (AzureADMultipleOrgs), so no Azure change is needed.
  // Override only for a deliberately single-tenant deployment.
  MICROSOFT_AUTHORITY: z.string().url().default('https://login.microsoftonline.com/organizations'),
  MICROSOFT_CERT_THUMBPRINT: z.string().optional(),
  MICROSOFT_CERT_PRIVATE_KEY: z.string().optional(),
  // APP_SIGN_IN_URL is injected by CDK per env (compute-stack apiSharedEnv).
  // The prod default here keeps prod working if ever run without CDK injection.
  APP_SIGN_IN_URL: z.string().url().default('https://app.capiro.ai/sign-in'),
  // Optional override for Clerk invitation redirect URLs. When unset, the
  // tenant-admin invitation flow derives the URL from the first entry of
  // WEB_ORIGIN (which is a comma-separated CORS allowlist). Set this
  // explicitly when the primary host differs from the first allowed
  // origin or when invitation links should land on a non-standard route.
  INVITATION_REDIRECT_URL: z.string().url().optional(),
  MICROSOFT_REDIRECT_URI: z
    .string()
    .url()
    .default('https://app.capiro.ai/api/engagement/integrations/microsoft/callback'),
  MICROSOFT_OAUTH_SUCCESS_REDIRECT: z.string().default('/settings/integrations'),
  MICROSOFT_GRAPH_NOTIFICATION_URL: z
    .string()
    .url()
    .default('https://app.capiro.ai/api/engagement/integrations/microsoft/notifications'),

  // Public landing page demo requests are stored in Postgres and emailed via
  // Amazon SES. The source address must be a verified SES identity.
  DEMO_REQUEST_EMAIL_FROM: z.string().email().default('sales@capiro.ai'),
  DEMO_REQUEST_EMAIL_TO: z.string().email().default('sales@capiro.ai'),

  // GovInfo (api.data.gov) — congressional bills, committee reports, public laws.
  // Key is an api.data.gov key sourced from Secrets Manager (injected as env by CDK).
  // Endpoints fail closed (the service throws) when the key is unset.
  GOVINFO_API_KEY: z.string().optional(),
  // S3 bucket for cached GovInfo PDFs (committee reports, public laws).
  GOVINFO_CACHE_BUCKET: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;
