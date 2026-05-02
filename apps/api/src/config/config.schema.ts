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
  AWS_REGION_DEFAULT: z.string().default('us-east-1'),
});

export type AppConfig = z.infer<typeof configSchema>;
