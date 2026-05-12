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
});

export type AppConfig = z.infer<typeof configSchema>;
