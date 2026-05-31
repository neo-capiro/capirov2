import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { commonTags, type EnvConfig } from './config';

export interface SecretsStackProps extends cdk.StackProps {
  cfg: EnvConfig;
}

/**
 * Application secrets, Clerk credentials, future LLM provider keys, etc.
 *
 * Created with PLACEHOLDER values. The operator fills real values via:
 *   aws secretsmanager put-secret-value --secret-id <id> --secret-string <value>
 *
 * Why not bake values into CDK:
 *   - SOC 2: secret material never lives in source control or CDK context.
 *   - Rotation: values change out from under CDK without forcing a stack update.
 *   - Per-env isolation: a leak in dev never reaches prod.
 *
 * KMS CMK is per-environment, separate from the data CMK in DataStack.
 */
export class SecretsStack extends cdk.Stack {
  public readonly clerkSecretKey: secretsmanager.Secret;
  public readonly clerkWebhookSigningSecret: secretsmanager.Secret;
  public readonly clerkPublishableKey: secretsmanager.Secret;
  public readonly clioApiServerKey: secretsmanager.Secret;
  public readonly govInfoApiKey: secretsmanager.Secret;
  public readonly secretsKey: kms.Key;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
    super(scope, id, props);
    const { cfg } = props;

    Object.entries(commonTags(cfg)).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    this.secretsKey = new kms.Key(this, 'SecretsKey', {
      alias: `alias/capiro/${cfg.envName}/secrets`,
      description: `Capiro ${cfg.envName} application secrets CMK`,
      enableKeyRotation: true,
      removalPolicy: cfg.protectFromDestroy
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    const removal = cfg.protectFromDestroy
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    this.clerkSecretKey = new secretsmanager.Secret(this, 'ClerkSecretKey', {
      secretName: `/capiro/${cfg.envName}/clerk/secret-key`,
      description: 'Clerk Backend API secret key (sk_live_...)',
      encryptionKey: this.secretsKey,
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_ME'),
      removalPolicy: removal,
    });

    this.clerkWebhookSigningSecret = new secretsmanager.Secret(this, 'ClerkWebhookSigningSecret', {
      secretName: `/capiro/${cfg.envName}/clerk/webhook-signing-secret`,
      description: 'Clerk webhook signing secret (whsec_...) verified by svix',
      encryptionKey: this.secretsKey,
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_ME'),
      removalPolicy: removal,
    });

    // Publishable key is technically public, but storing it alongside the
    // others keeps the env wiring symmetrical and lets us rotate it via the
    // same put-secret-value flow if Clerk ever rotates instances.
    this.clerkPublishableKey = new secretsmanager.Secret(this, 'ClerkPublishableKey', {
      secretName: `/capiro/${cfg.envName}/clerk/publishable-key`,
      description: 'Clerk publishable key (pk_live_...), exposed to the browser via runtime-config.js',
      encryptionKey: this.secretsKey,
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_ME'),
      removalPolicy: removal,
    });

    this.clioApiServerKey = new secretsmanager.Secret(this, 'ClioApiServerKey', {
      secretName: `/capiro/${cfg.envName}/clio/api-server-key`,
      description: 'Bearer token shared by Capiro API and the private Clio runtime',
      encryptionKey: this.secretsKey,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 48,
      },
      removalPolicy: removal,
    });

    // GovInfo / api.data.gov key for congressional bills, committee reports, and
    // public laws. Placeholder; operator sets the real api.data.gov key via
    // put-secret-value. Consumed by GovInfoService as the GOVINFO_API_KEY env var.
    this.govInfoApiKey = new secretsmanager.Secret(this, 'GovInfoApiKey', {
      secretName: `/capiro/${cfg.envName}/govinfo/api-key`,
      description: 'api.data.gov key for GovInfo (BILLS / CRPT / PLAW / CHRG)',
      encryptionKey: this.secretsKey,
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_ME'),
      removalPolicy: removal,
    });

    new cdk.CfnOutput(this, 'ClerkSecretKeyArn', {
      value: this.clerkSecretKey.secretArn,
      exportName: `Capiro-${cfg.envName}-ClerkSecretKeyArn`,
    });
    new cdk.CfnOutput(this, 'ClerkWebhookSecretArn', {
      value: this.clerkWebhookSigningSecret.secretArn,
      exportName: `Capiro-${cfg.envName}-ClerkWebhookSecretArn`,
    });
    new cdk.CfnOutput(this, 'ClerkPublishableKeyArn', {
      value: this.clerkPublishableKey.secretArn,
      exportName: `Capiro-${cfg.envName}-ClerkPublishableKeyArn`,
    });
    new cdk.CfnOutput(this, 'ClioApiServerKeyArn', {
      value: this.clioApiServerKey.secretArn,
      exportName: `Capiro-${cfg.envName}-ClioApiServerKeyArn`,
    });
    new cdk.CfnOutput(this, 'SecretsKeyArn', {
      value: this.secretsKey.keyArn,
      exportName: `Capiro-${cfg.envName}-SecretsKeyArn`,
    });
  }

  grantRead(grantee: iam.IGrantable): void {
    this.clerkSecretKey.grantRead(grantee);
    this.clerkWebhookSigningSecret.grantRead(grantee);
    this.clerkPublishableKey.grantRead(grantee);
    this.clioApiServerKey.grantRead(grantee);
    this.secretsKey.grantDecrypt(grantee);
  }
}
