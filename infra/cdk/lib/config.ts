import * as cdk from 'aws-cdk-lib';

export type EnvName = 'dev' | 'staging' | 'prod' | 'prod-os-capiro';

export interface EnvConfig {
  envName: EnvName;
  account: string;
  region: string;
  // DNS
  hostedZoneDomain: string; // Route 53 zone that owns the records.
  rootDomain: string; // capiro.ai (prod) | app-dev.capiro.ai (dev)
  vpcCidr: string; // VPC IPv4 range. Distinct per env to allow future peering.
  // When true, ComputeStack builds TWO independent ALBs in separate AZ sets behind a
  // Route53 failover record set (primary/secondary + health checks) for full
  // active/passive load-balancer redundancy. When false, a single multi-AZ ALB (itself
  // AZ-redundant) is used. prod-os-capiro = true (Neo, 2026-06-13).
  redundantLoadBalancer: boolean;
  appHost: string; // app.capiro.ai (prod) | app-dev.capiro.ai (dev)
  wildcardHost: string; // *.app.capiro.ai (prod) | *.app-dev.capiro.ai (dev)
  // Clerk JWT issuer URL, injected into the ECS task as CLERK_JWT_ISSUER.
  // Set after creating the Clerk instance for each env. If absent, the API
  // skips issuer validation (acceptable during initial bootstrap only).
  clerkJwtIssuer?: string;
  // Aurora
  auroraMinAcu: number;
  auroraMaxAcu: number;
  auroraBackupRetentionDays: number;
  // ECS service sizing
  apiCpu: number;
  apiMemoryMib: number;
  apiDesiredCount: number;
  apiMaxCount: number;
  webCpu: number;
  webMemoryMib: number;
  webDesiredCount: number;
  webMaxCount: number;
  marketingCpu: number;
  marketingMemoryMib: number;
  marketingDesiredCount: number;
  marketingMaxCount: number;
  // Hardening
  protectFromDestroy: boolean; // true for prod, false for dev to allow iteration
  logRetentionDays: number;
  externalSecretArns?: {
    microsoftClientId: string;
    microsoftTenantId: string;
    microsoftCertThumbprint: string;
    microsoftCertPrivateKey: string;
    oauthTokenEncryptionKey: string;
    oauthStateSecret: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    notesEncryptionKey: string;
    samGovApiKey?: string;
    aiCredentialEncryptionKey?: string;
  };
}

const BASE: Omit<EnvConfig, 'envName' | 'account' | 'region'> = {
  hostedZoneDomain: 'capiro.ai',
  rootDomain: 'capiro.ai',
  appHost: 'app.capiro.ai',
  wildcardHost: '*.app.capiro.ai',
  vpcCidr: '10.40.0.0/16',
  redundantLoadBalancer: false,
  auroraMinAcu: 0.5,
  auroraMaxAcu: 4,
  auroraBackupRetentionDays: 35,
  apiCpu: 512,
  apiMemoryMib: 1024,
  apiDesiredCount: 2,
  apiMaxCount: 6,
  webCpu: 256,
  webMemoryMib: 512,
  webDesiredCount: 2,
  webMaxCount: 4,
  marketingCpu: 256,
  marketingMemoryMib: 512,
  marketingDesiredCount: 2,
  marketingMaxCount: 4,
  protectFromDestroy: false,
  logRetentionDays: 90,
};

export function loadConfig(app: cdk.App): EnvConfig {
  const envName = (app.node.tryGetContext('env') as EnvName | undefined) ?? 'dev';
  if (!['dev', 'staging', 'prod', 'prod-os-capiro'].includes(envName)) {
    throw new Error(`Unknown env=${envName}`);
  }
  const account =
    (app.node.tryGetContext('account') as string | undefined) ?? process.env.CDK_DEFAULT_ACCOUNT;
  if (!account) {
    throw new Error(
      'AWS account not set. Pass --context account=<id> or export CDK_DEFAULT_ACCOUNT.',
    );
  }
  const region =
    (app.node.tryGetContext('region') as string | undefined) ??
    process.env.CDK_DEFAULT_REGION ??
    'us-east-1';

  const overrides: Partial<EnvConfig> =
    envName === 'prod-os-capiro'
      ? {
          // prod-os-capiro: a brand-new, fully ISOLATED production environment on its
          // OWN domain (prodos.capiro.ai), with its OWN VPC, Aurora, ALB, ECS cluster,
          // and secrets. Built greenfield so it never collides with the live system that
          // the env=dev stacks currently serve at app.capiro.ai. Stacks are named
          // `Capiro-prod-os-capiro-*` and touch nothing named `Capiro-dev-*`. DNS cutover
          // to this env happens later as a separate, explicitly gated step.
          hostedZoneDomain: 'prodos.capiro.ai', // delegated Route 53 zone — MUST exist before DnsStack deploy
          appHost: 'app.prodos.capiro.ai',
          wildcardHost: '*.app.prodos.capiro.ai',
          rootDomain: 'prodos.capiro.ai',
          // Dedicated, non-overlapping VPC range so prod-os-capiro never collides with the
          // live dev/staging VPCs (both 10.40.0.0/16) and can be VPC-peered later if needed.
          vpcCidr: '10.50.0.0/16',
          // Full active/passive load-balancer redundancy: two ALBs + Route53 failover
          // (Neo, 2026-06-13). Implemented in ComputeStack (Phase 2).
          redundantLoadBalancer: true,
          // Production sizing.
          auroraMinAcu: 1,
          auroraMaxAcu: 8,
          auroraBackupRetentionDays: 35,
          apiDesiredCount: 3,
          apiMaxCount: 12,
          webDesiredCount: 2,
          webMaxCount: 6,
          protectFromDestroy: true,
          logRetentionDays: 365,
          // AUTH (approved by Neo for prod-os-capiro): wired to the prod-os-capiro Clerk
          // PRODUCTION instance issuer. Clerk forces the prod Frontend API to
          // clerk.<registrable-domain>; since the root is capiro.ai the issuer is
          // clerk.capiro.ai (it could NOT be clerk.prodos.capiro.ai). This is a DISTINCT
          // Clerk app from the live one (clerk.app.capiro.ai) — the live app is untouched.
          // The 5 Clerk CNAMEs (clerk/accounts/clkmail/clk._domainkey/clk2._domainkey on
          // capiro.ai) were added CREATE-only to the capiro.ai zone on 2026-06-13; token
          // validation succeeds once Clerk finishes verifying DNS + the pk_live/sk_live
          // keys are deployed to the web/api tasks.
          // Clerk app_3F4N127oWJRaBMbyYAhawaj8rtG / prod instance ins_3F4NH7HrBDizvAoVoLhNltYfrAW.
          clerkJwtIssuer: 'https://clerk.capiro.ai',
          // SECRETS: externalSecretArns is intentionally OMITTED. The prod-os-capiro
          // secrets (Clerk secret key, OpenAI, Anthropic, oauth keys, etc.) must be created
          // under capiro/prod-os-capiro/* with COMPLETE ARNs before any ComputeStack
          // deploy (partial ARNs cause ECS ResourceInitializationError). EMAIL/Graph
          // internals stay frozen until explicitly approved.
        }
      : envName === 'prod'
      ? {
          auroraMinAcu: 1,
          auroraMaxAcu: 8,
          apiDesiredCount: 3,
          apiMaxCount: 12,
          webDesiredCount: 2,
          webMaxCount: 6,
          protectFromDestroy: true,
          logRetentionDays: 365,
          clerkJwtIssuer: 'https://clerk.app.capiro.ai',
        }
      : envName === 'staging'
        ? {
            // Staging serves the app at app.staging.capiro.ai and the marketing
            // site at staging.capiro.ai. The base config defaults appHost to
            // `app.capiro.ai` (prod), which makes the API derive a
            // MICROSOFT_REDIRECT_URI pointing at prod and breaks the Microsoft
            // 365 OAuth callback from staging tenants (the callback lands on
            // the wrong stack, hits the wrong Aurora cluster, throws
            // "Record not found" trying to update the IntegrationConnection,
            // and returns 500 to the user). Pin the host explicitly here so
            // every host-derived env var (MICROSOFT_REDIRECT_URI,
            // MICROSOFT_GRAPH_NOTIFICATION_URL, APP_SIGN_IN_URL, WEB_ORIGIN)
            // points at staging's own ALB.
            // staging.capiro.ai is a delegated Route 53 zone in this same
            // account. Point the DNS lookup at it so the A/AAAA records
            // CDK manages for staging land in the delegated zone instead of
            // the parent capiro.ai zone (where they would be shadowed by
            // the NS delegation and silently fail to resolve).
            hostedZoneDomain: 'staging.capiro.ai',
            appHost: 'app.staging.capiro.ai',
            wildcardHost: '*.app.staging.capiro.ai',
            rootDomain: 'staging.capiro.ai',
            protectFromDestroy: true,
          }
        : {
            // Dev/prod account: 967807252336  region: us-east-1
            // Aligned to live production reality (see infra/cdk/DRIFT-FINDINGS.md).
            // The env=dev stacks ARE prod and serve app.capiro.ai / capiro.ai —
            // NOT app-dev.*. appHost + wildcardHost feed WEB_ORIGIN and the
            // invitation redirect (tenant-admin uses WEB_ORIGIN.split(',')[0]);
            // leaving these as app-dev produced invitation links to a dead host,
            // so invited users could never complete sign-up. cdk diff before deploy.
            appHost: 'app.capiro.ai',
            wildcardHost: '*.app.capiro.ai',
            rootDomain: 'capiro.ai',
            // Single replicas for dev, no HA needed.
            apiDesiredCount: 1,
            apiMaxCount: 2,
            webDesiredCount: 1,
            webMaxCount: 2,
            marketingDesiredCount: 1,
            marketingMaxCount: 2,
            auroraMinAcu: 0.5,
            auroraMaxAcu: 2,
            auroraBackupRetentionDays: 7,
            // NOTE: the env=dev stacks (cluster `capiro-dev`) ARE the live
            // production deployment serving app.capiro.ai. The running API and
            // the web's pk_live publishable key both use the PROD Clerk instance
            // `clerk.app.capiro.ai`. This issuer MUST match it — pointing it at
            // the throwaway dev instance (stirring-warthog-40.clerk.accounts.dev)
            // would make every live user token fail validation (401 / logged
            // out) on the next `cdk deploy`. Do not change without rotating the
            // web publishable key + API secret to the same instance.
            clerkJwtIssuer: 'https://clerk.app.capiro.ai',
            //
            // Fill in after creating each secret in account 967807252336.
            // Slash-delimited names require complete ARNs; partial ARNs cause
            // ECS task startup failures (ResourceInitializationError).
            // Run for each: aws secretsmanager describe-secret \
            //   --secret-id capiro/dev/<name> --query ARN --output text
            externalSecretArns: {
              microsoftClientId:       'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/microsoft-client-id-AU8xuO',
              microsoftTenantId:       'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/microsoft-tenant-id-cC9TIB',
              microsoftCertThumbprint: 'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/microsoft-cert-thumbprint-gJsG0v',
              microsoftCertPrivateKey: 'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/microsoft-cert-private-key-rW9ERB',
              oauthTokenEncryptionKey: 'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/oauth-token-encryption-key-VQCjD8',
              oauthStateSecret:        'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/oauth-state-secret-XOOzYB',
              openaiApiKey:            'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/openai-api-key-7nAmib',
              anthropicApiKey:         'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/anthropic-api-key-3nhKhF',
              notesEncryptionKey:      'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/notes-encryption-key-Vf2rhI',
              samGovApiKey:            'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/sam-gov-api-key-0gcMpp',
              aiCredentialEncryptionKey: 'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/ai-credential-encryption-key-ohnjaH',
            },
          };

  return { ...BASE, envName, account, region, ...overrides };
}

export function stackName(envName: EnvName, suffix: string): string {
  return `Capiro-${envName}-${suffix}`;
}

export function awsEnv(cfg: EnvConfig): cdk.Environment {
  return { account: cfg.account, region: cfg.region };
}

export function commonTags(cfg: EnvConfig): Record<string, string> {
  return {
    Project: 'capiro',
    Environment: cfg.envName,
    ManagedBy: 'cdk',
  };
}
