import * as cdk from 'aws-cdk-lib';

export type EnvName = 'dev' | 'staging' | 'prod';

export interface EnvConfig {
  envName: EnvName;
  account: string;
  region: string;
  // DNS
  rootDomain: string; // capiro.ai
  appHost: string; // app.capiro.ai
  wildcardHost: string; // *.app.capiro.ai
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
  // Clerk JWT issuer URL — used by the API to validate session tokens.
  // prod uses the custom CNAME (clerk.app.capiro.ai); staging uses the
  // separate Dev-Capiro Clerk instance.
  clerkJwtIssuer: string;
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
  };
}

const BASE: Omit<EnvConfig, 'envName' | 'account' | 'region'> = {
  rootDomain: 'capiro.ai',
  appHost: 'app.capiro.ai',
  wildcardHost: '*.app.capiro.ai',
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
  clerkJwtIssuer: 'https://clerk.app.capiro.ai',
  protectFromDestroy: false,
  logRetentionDays: 90,
};

export function loadConfig(app: cdk.App): EnvConfig {
  const envName = (app.node.tryGetContext('env') as EnvName | undefined) ?? 'dev';
  if (!['dev', 'staging', 'prod'].includes(envName)) {
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
    envName === 'prod'
      ? {
          auroraMinAcu: 1,
          auroraMaxAcu: 8,
          apiDesiredCount: 3,
          apiMaxCount: 12,
          webDesiredCount: 2,
          webMaxCount: 6,
          protectFromDestroy: true,
          logRetentionDays: 365,
        }
      : envName === 'staging'
        ? {
            // Staging is the pre-promotion testbed. Lives in the same AWS
            // account as prod (967807252336) but at staging.capiro.ai with
            // its own ALB, Aurora, and ECS cluster. Cost-optimized.
            rootDomain: 'staging.capiro.ai',
            appHost: 'staging.capiro.ai',
            wildcardHost: '*.staging.capiro.ai',
            clerkJwtIssuer: 'https://stirring-warthog-40.clerk.accounts.dev',
            apiDesiredCount: 1,
            apiMaxCount: 2,
            webDesiredCount: 1,
            webMaxCount: 2,
            marketingDesiredCount: 1,
            marketingMaxCount: 2,
            auroraMinAcu: 0, // auto-pause when idle
            auroraMaxAcu: 2,
            auroraBackupRetentionDays: 1,
            protectFromDestroy: false,
            logRetentionDays: 7,
            // Reuse the existing capiro/dev/* external secrets in 967807252336.
            // These are external API keys (Microsoft, OAuth, LLM providers,
            // notes encryption) — same values are valid for staging and prod.
            externalSecretArns: {
              microsoftClientId:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/microsoft-client-id-AU8xuO',
              microsoftTenantId:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/microsoft-tenant-id-cC9TIB',
              microsoftCertThumbprint:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/microsoft-cert-thumbprint-gJsG0v',
              microsoftCertPrivateKey:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/microsoft-cert-private-key-rW9ERB',
              oauthTokenEncryptionKey:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/oauth-token-encryption-key-VQCjD8',
              oauthStateSecret:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/oauth-state-secret-XOOzYB',
              openaiApiKey:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/openai-api-key-7nAmib',
              anthropicApiKey:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/anthropic-api-key-3nhKhF',
              notesEncryptionKey:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/notes-encryption-key-Vf2rhI',
            },
          }
        : {
            externalSecretArns: {
              microsoftClientId:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/microsoft-client-id-AU8xuO',
              microsoftTenantId:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/microsoft-tenant-id-cC9TIB',
              microsoftCertThumbprint:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/microsoft-cert-thumbprint-gJsG0v',
              microsoftCertPrivateKey:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/microsoft-cert-private-key-rW9ERB',
              oauthTokenEncryptionKey:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/oauth-token-encryption-key-VQCjD8',
              oauthStateSecret:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/oauth-state-secret-XOOzYB',
              openaiApiKey:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/openai-api-key-7nAmib',
              anthropicApiKey:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/anthropic-api-key-3nhKhF',
              notesEncryptionKey:
                'arn:aws:secretsmanager:us-east-1:967807252336:secret:capiro/dev/notes-encryption-key-Vf2rhI',
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
