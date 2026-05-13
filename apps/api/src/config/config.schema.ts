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

  // Optional. When set, the Clio web_search tool uses Tavily for high-
  // quality AI-tuned search. Unset → falls back to DuckDuckGo Instant
  // Answer (free but returns only entity abstracts). Provision via
  // https://tavily.com → 1000 free searches/month is plenty for staging.
  TAVILY_API_KEY: z.string().optional(),

  // Optional AI providers. Meeting prep endpoints fail closed with 503 until
  // one provider key is configured; they never return canned prep.
  AI_PROVIDER: z.enum(['openai', 'anthropic']).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),

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
  MICROSOFT_TENANT_ID: z.string().optional(),
  MICROSOFT_CERT_THUMBPRINT: z.string().optional(),
  MICROSOFT_CERT_PRIVATE_KEY: z.string().optional(),
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

  // Clio agent runtime base URL — internal Cloud Map DNS resolved only
  // from inside the VPC, e.g. http://clio.capiro-staging.local:8000.
  // Optional in dev (Workspace endpoints throw 503 when empty).
  CLIO_BASE_URL: z.string().url().or(z.literal('')).default(''),
  // Bearer token Clio sends on /api/clio/internal/* callbacks. Injected
  // from Secrets Manager in deployed envs; empty default means the
  // internal routes refuse all traffic in local dev (correct fail-closed
  // behaviour — they should never be exposed without the secret set).
  CLIO_INBOUND_SHARED_SECRET: z.string().default(''),
  // Cloud Map URL for the clio-sandbox code-execution service. When
  // empty, the code_interpreter tool returns a "not provisioned" error
  // instead of attempting the call. See OVERNIGHT_DECISIONS_CODE_EXEC.md
  // §16 for the full architecture.
  CLIO_SANDBOX_BASE_URL: z.string().url().or(z.literal('')).default(''),
  // Domain the per-user Clio mailboxes live under. Each user gets
  // <slug>@<CLIO_MAIL_DOMAIN>. See OVERNIGHT_DECISIONS_LOCKED.md §4.
  CLIO_MAIL_DOMAIN: z.string().default('clio.capiro.ai'),
  // When 'true', the send_email tool actually dispatches via SES.
  // Otherwise the outbound row is persisted and the tool returns
  // queued=true so the agent can tell the user the send is staged.
  // Flip to 'true' once SES domain verification + DKIM/SPF/DMARC are
  // live for CLIO_MAIL_DOMAIN.
  CLIO_MAIL_SEND_ENABLED: z.string().default('false'),
  // Shared secret the inbound-mail Lambda HMAC-signs payloads with.
  // The /webhooks/clio-mail route validates against this. Empty means
  // the webhook fails closed — no inbound mail is accepted.
  CLIO_MAIL_WEBHOOK_SECRET: z.string().default(''),

  // ---------------------------------------------------------------------
  // Third-party connector keys. Each tool fails closed (returns ok:false,
  // configured:false) when its key is unset, so the agent can tell the
  // user "this connector isn't wired up in this environment". No tool
  // throws — the model handles missing-config the same way it handles a
  // 503, by reporting back to the user.
  // ---------------------------------------------------------------------

  // Firecrawl: agent-first web scrape + search.
  // https://firecrawl.dev → starter tier ~$20/mo.
  FIRECRAWL_API_KEY: z.string().optional(),

  // Readwise: highlights search across the user's saved reading.
  // https://readwise.io/access_token (free for personal accounts).
  // Per-user in the real world; we accept a tenant-wide key for now and
  // gate it behind the connector card.
  READWISE_API_KEY: z.string().optional(),

  // Apify: pre-built scrapers (X/LinkedIn/Instagram/Google Maps/etc).
  // https://console.apify.com/account/integrations
  APIFY_API_TOKEN: z.string().optional(),

  // Browserbase: real-browser sessions for logins/clicks/forms.
  // https://www.browserbase.com — need API key + project ID.
  BROWSERBASE_API_KEY: z.string().optional(),
  BROWSERBASE_PROJECT_ID: z.string().optional(),

  // Reddit read-only via the public JSON endpoints — no key required for
  // GETs, just a respectful User-Agent. This is the UA we send.
  REDDIT_USER_AGENT: z
    .string()
    .default('CapiroClio/1.0 (https://capiro.ai; contact: support@capiro.ai)'),
});

export type AppConfig = z.infer<typeof configSchema>;
