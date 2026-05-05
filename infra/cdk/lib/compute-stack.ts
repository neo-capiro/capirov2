import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { commonTags, type EnvConfig } from './config';
import type { SecretsStack } from './secrets-stack';
import type { AssetsStack } from './assets-stack';

export interface ComputeStackProps extends cdk.StackProps {
  cfg: EnvConfig;
  vpc: ec2.IVpc;
  albSecurityGroup: ec2.ISecurityGroup;
  serviceSecurityGroup: ec2.ISecurityGroup;
  dbCluster: rds.IDatabaseCluster;
  dbSecret: secretsmanager.ISecret;
  appDbSecret: secretsmanager.ISecret;
  databaseName: string;
  dataKey: kms.IKey;
  secretsStack: SecretsStack;
  certificate: acm.ICertificate;
  apexCertificate: acm.ICertificate;
  hostedZone: route53.IHostedZone;
  assetsStack: AssetsStack;
}

/**
 * ECS + ALB + ECR + WAF.
 *
 * One ALB serves both web and API via path-based routing on the same hostname:
 *   - Default action → web target group (nginx serving the SPA)
 *   - /api/* and /webhooks/* → API target group (NestJS)
 *
 * Routes for both `app.capiro.ai` and `*.app.capiro.ai` (tenant vanity URLs)
 * land at the same listener. The web container ignores the host header at
 * the nginx layer; the API middleware reads it for tenant resolution.
 *
 * Migrations are a separate task definition (`apiMigrateTaskDefinition`) the
 * operator runs explicitly via `aws ecs run-task` BEFORE rolling out a new
 * API image. Forward-only, expand-then-contract.
 */
export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly apiRepo: ecr.IRepository;
  public readonly webRepo: ecr.IRepository;
  public readonly marketingRepo: ecr.IRepository;
  public readonly alb: elb.ApplicationLoadBalancer;
  public readonly apiService: ecs.FargateService;
  public readonly webService: ecs.FargateService;
  public readonly marketingService: ecs.FargateService;
  public readonly apiMigrateTaskDefinition: ecs.FargateTaskDefinition;
  public readonly apiBootstrapRolesTaskDefinition: ecs.FargateTaskDefinition;
  public readonly apiTargetGroup: elb.ApplicationTargetGroup;
  public readonly webTargetGroup: elb.ApplicationTargetGroup;
  public readonly marketingTargetGroup: elb.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);
    const {
      cfg,
      vpc,
      albSecurityGroup,
      serviceSecurityGroup,
      dbCluster,
      dbSecret,
      appDbSecret,
      databaseName,
      dataKey,
      secretsStack,
      certificate,
      apexCertificate,
      hostedZone,
      assetsStack,
    } = props;

    Object.entries(commonTags(cfg)).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    // ------------------------------------------------------------------ Cross-stack imports
    // Re-import secrets + KMS keys by ARN so CDK treats them as external to
    // this stack. Without this, helpers like `ecs.Secret.fromSecretsManager`
    // and `secret.grantRead` try to mutate the resource policy in the owning
    // stack — which would force a Data/Secrets → Compute dependency and create
    // a cycle.
    const dbSecretImported = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'ImportedDbSecret',
      dbSecret.secretArn,
    );
    const appDbSecretImported = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'ImportedAppDbSecret',
      appDbSecret.secretArn,
    );
    const clerkSecretKeyImported = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'ImportedClerkSecretKey',
      secretsStack.clerkSecretKey.secretArn,
    );
    const clerkWebhookImported = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'ImportedClerkWebhook',
      secretsStack.clerkWebhookSigningSecret.secretArn,
    );
    const clerkPubKeyImported = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'ImportedClerkPubKey',
      secretsStack.clerkPublishableKey.secretArn,
    );

    // Microsoft 365 Graph OAuth + token-at-rest crypto. These secrets are
    // provisioned out-of-band and imported by complete ARN when available. ECS
    // task secret injection requires complete ARNs for these slash-delimited
    // names; partial ARNs caused new API tasks to fail before startup.
    const microsoftClientIdSecret = importExternalSecret(
      this,
      'ImportedMicrosoftClientId',
      `capiro/${cfg.envName}/microsoft-client-id`,
      cfg.externalSecretArns?.microsoftClientId,
    );
    const microsoftTenantIdSecret = importExternalSecret(
      this,
      'ImportedMicrosoftTenantId',
      `capiro/${cfg.envName}/microsoft-tenant-id`,
      cfg.externalSecretArns?.microsoftTenantId,
    );
    const microsoftCertThumbprintSecret = importExternalSecret(
      this,
      'ImportedMicrosoftCertThumbprint',
      `capiro/${cfg.envName}/microsoft-cert-thumbprint`,
      cfg.externalSecretArns?.microsoftCertThumbprint,
    );
    const microsoftCertPrivateKeySecret = importExternalSecret(
      this,
      'ImportedMicrosoftCertPrivateKey',
      `capiro/${cfg.envName}/microsoft-cert-private-key`,
      cfg.externalSecretArns?.microsoftCertPrivateKey,
    );
    const oauthTokenEncryptionKeySecret = importExternalSecret(
      this,
      'ImportedOauthTokenEncryptionKey',
      `capiro/${cfg.envName}/oauth-token-encryption-key`,
      cfg.externalSecretArns?.oauthTokenEncryptionKey,
    );
    const oauthStateSecret = importExternalSecret(
      this,
      'ImportedOauthStateSecret',
      `capiro/${cfg.envName}/oauth-state-secret`,
      cfg.externalSecretArns?.oauthStateSecret,
    );
    const openaiApiKeySecret = importExternalSecret(
      this,
      'ImportedOpenAiApiKey',
      `capiro/${cfg.envName}/openai-api-key`,
      cfg.externalSecretArns?.openaiApiKey,
    );
    const anthropicApiKeySecret = importExternalSecret(
      this,
      'ImportedAnthropicApiKey',
      `capiro/${cfg.envName}/anthropic-api-key`,
      cfg.externalSecretArns?.anthropicApiKey,
    );

    // ------------------------------------------------------------------ ECR
    // Repos are pre-created out-of-band so images can be pushed BEFORE the
    // first ComputeStack deploy (otherwise the Fargate service has no image
    // to pull on first boot). CDK imports the existing repos and references
    // their `:latest` tag for the task definitions.
    this.apiRepo = ecr.Repository.fromRepositoryName(this, 'ApiRepo', `capiro/${cfg.envName}/api`);
    this.webRepo = ecr.Repository.fromRepositoryName(this, 'WebRepo', `capiro/${cfg.envName}/web`);

    // ------------------------------------------------------------------ ECS cluster
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: `capiro-${cfg.envName}`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
      enableFargateCapacityProviders: true,
    });

    // Log groups are RETAIN even in dev — when an ECS service fails its first
    // deploy, CFN rolls back and would otherwise destroy the logs that explain
    // why. Keeping them lets us iterate without losing the failure trail.
    const apiLogGroup = new logs.LogGroup(this, 'ApiLogs', {
      logGroupName: `/capiro/${cfg.envName}/api`,
      retention: cfg.logRetentionDays as unknown as logs.RetentionDays,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const webLogGroup = new logs.LogGroup(this, 'WebLogs', {
      logGroupName: `/capiro/${cfg.envName}/web`,
      retention: cfg.logRetentionDays as unknown as logs.RetentionDays,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const migrateLogGroup = new logs.LogGroup(this, 'ApiMigrateLogs', {
      logGroupName: `/capiro/${cfg.envName}/api-migrate`,
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: cfg.protectFromDestroy ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ------------------------------------------------------------------ Task roles
    // Execution role: pulls images from ECR + writes logs + reads ECS-managed secrets.
    // Task role:      what the container code runs as. Grant least-privilege here.
    const apiTaskRole = new iam.Role(this, 'ApiTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Capiro API task role',
    });
    // The capiro.ai SES identity and DKIM Route 53 records are operationally
    // managed so we can preserve the verified identity across Compute stack
    // updates. The API only needs permission to send through those identities.
    const demoRequestDomainIdentityArn = `arn:aws:ses:${this.region}:${this.account}:identity/${cfg.rootDomain}`;

    // Grants below use explicit policy statements rather than `secret.grantRead()`
    // / `key.grantDecrypt()`. The convenience helpers mutate the *resource*
    // policy in the owning stack (Data, Secrets) to add the granted role's
    // ARN, which creates a cross-stack cyclic reference. Identity-only policy
    // statements keep the dependency direction one-way: Compute → Data, Compute
    // → Secrets.
    apiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
        resources: [
          dbSecretImported.secretArn,
          appDbSecretImported.secretArn,
          clerkSecretKeyImported.secretArn,
          clerkWebhookImported.secretArn,
          clerkPubKeyImported.secretArn,
          // Trailing `*` (no preceding dash) matches both the bare name and
          // the auto-generated `-XXXXXX` version suffix Secrets Manager
          // appends to every secret ARN.
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/microsoft-client-id*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/microsoft-tenant-id*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/microsoft-cert-thumbprint*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/microsoft-cert-private-key*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/oauth-token-encryption-key*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/oauth-state-secret*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/openai-api-key*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/anthropic-api-key*`,
        ],
      }),
    );
    apiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [dataKey.keyArn, secretsStack.secretsKey.keyArn],
      }),
    );
    apiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [
          demoRequestDomainIdentityArn,
          `arn:aws:ses:${this.region}:${this.account}:identity/sales@capiro.ai`,
        ],
      }),
    );

    const webTaskRole = new iam.Role(this, 'WebTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Capiro Web task role',
    });
    // Web only needs to log + (if we add /healthz pinging) the basics.

    // ------------------------------------------------------------------ Task secret bundles
    // The API runs as `capiro_app` (least-privilege, no DDL). Migrations
    // continue to run as the master role because Prisma needs DDL.
    // host/port/dbname come from the master secret (same Aurora cluster);
    // only the username/password switch between the two tasks.
    const apiServeSecrets = {
      CLERK_SECRET_KEY: ecs.Secret.fromSecretsManager(clerkSecretKeyImported),
      CLERK_WEBHOOK_SIGNING_SECRET: ecs.Secret.fromSecretsManager(clerkWebhookImported),
      DB_HOST: ecs.Secret.fromSecretsManager(dbSecretImported, 'host'),
      DB_PORT: ecs.Secret.fromSecretsManager(dbSecretImported, 'port'),
      DB_USER: ecs.Secret.fromSecretsManager(appDbSecretImported, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(appDbSecretImported, 'password'),
      MICROSOFT_CLIENT_ID: ecs.Secret.fromSecretsManager(microsoftClientIdSecret),
      MICROSOFT_TENANT_ID: ecs.Secret.fromSecretsManager(microsoftTenantIdSecret),
      MICROSOFT_CERT_THUMBPRINT: ecs.Secret.fromSecretsManager(microsoftCertThumbprintSecret),
      MICROSOFT_CERT_PRIVATE_KEY: ecs.Secret.fromSecretsManager(microsoftCertPrivateKeySecret),
      OAUTH_TOKEN_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(oauthTokenEncryptionKeySecret),
      OAUTH_STATE_SECRET: ecs.Secret.fromSecretsManager(oauthStateSecret),
      OPENAI_API_KEY: ecs.Secret.fromSecretsManager(openaiApiKeySecret),
      ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(anthropicApiKeySecret),
    };
    const apiMigrateSecrets = {
      CLERK_SECRET_KEY: ecs.Secret.fromSecretsManager(clerkSecretKeyImported),
      CLERK_WEBHOOK_SIGNING_SECRET: ecs.Secret.fromSecretsManager(clerkWebhookImported),
      DB_HOST: ecs.Secret.fromSecretsManager(dbSecretImported, 'host'),
      DB_PORT: ecs.Secret.fromSecretsManager(dbSecretImported, 'port'),
      DB_USER: ecs.Secret.fromSecretsManager(dbSecretImported, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecretImported, 'password'),
    };

    const apiSharedEnv: Record<string, string> = {
      NODE_ENV: cfg.envName === 'dev' ? 'development' : 'production',
      LOG_LEVEL: 'info',
      API_PORT: '4000',
      API_BIND_HOST: '0.0.0.0',
      DB_NAME: databaseName,
      CLERK_JWT_ISSUER: 'https://clerk.app.capiro.ai',
      WEB_ORIGIN: `https://${cfg.appHost},https://${cfg.wildcardHost.replace('*', 'acmelobby')}`,
      ASSETS_BUCKET: assetsStack.bucket.bucketName,
      AWS_REGION_DEFAULT: this.region,
    };

    // Identity-policy-only grant on the API task role for the assets bucket.
    assetsStack.grantApiAccess(apiTaskRole);

    // Read-only access to the pre-existing Hill directory data bucket. The
    // DirectoryService gunzips JSON snapshots out of this bucket on demand;
    // the bucket itself is provisioned out-of-band (not owned by this CDK app).
    apiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: ['arn:aws:s3:::updated-directory-967807252336-us-east-1/*'],
      }),
    );
    apiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: ['arn:aws:s3:::updated-directory-967807252336-us-east-1'],
      }),
    );

    // ------------------------------------------------------------------ API task definition + service
    const apiTaskDef = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
      family: `capiro-${cfg.envName}-api`,
      cpu: cfg.apiCpu,
      memoryLimitMiB: cfg.apiMemoryMib,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      taskRole: apiTaskRole,
    });

    // The execution role (auto-created by FargateTaskDefinition) is what ECS
    // uses to fetch images, write logs, and resolve `secrets:` references at
    // task startup. For OWN-stack secrets, CDK auto-grants kms:Decrypt; for
    // IMPORTED secrets it cannot, so we add it explicitly. Without these the
    // task fails to start with "ResourceInitializationError: unable to pull
    // secrets" and ECS deployment-circuit-breaker rolls the service back.
    // ARN patterns for the out-of-band Microsoft, OAuth, and AI secrets. The trailing
    // `*` (no preceding dash) matches BOTH the bare name (which `fromSecretNameV2`
    // bakes into the task definition) AND the version-suffixed form Secrets
    // Manager appends to every secret ARN.
    const externalRuntimeSecretArnPatterns = [
      `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/microsoft-client-id*`,
      `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/microsoft-tenant-id*`,
      `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/microsoft-cert-thumbprint*`,
      `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/microsoft-cert-private-key*`,
      `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/oauth-token-encryption-key*`,
      `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/oauth-state-secret*`,
      `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/openai-api-key*`,
      `arn:aws:secretsmanager:${this.region}:${this.account}:secret:capiro/${cfg.envName}/anthropic-api-key*`,
    ];

    grantSecretsAndKmsToExecutionRole(
      apiTaskDef,
      [
        dbSecretImported.secretArn,
        clerkSecretKeyImported.secretArn,
        clerkWebhookImported.secretArn,
        ...externalRuntimeSecretArnPatterns,
      ],
      [dataKey.keyArn, secretsStack.secretsKey.keyArn],
    );

    const apiContainer = apiTaskDef.addContainer('api', {
      image: ecs.ContainerImage.fromEcrRepository(this.apiRepo, 'latest'),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup: apiLogGroup, streamPrefix: 'api' }),
      environment: apiSharedEnv,
      secrets: apiServeSecrets,
      readonlyRootFilesystem: true,
      // Container exposes 4000; ALB target group hits /health.
      portMappings: [{ containerPort: 4000, protocol: ecs.Protocol.TCP }],
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://127.0.0.1:4000/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(30),
      },
    });

    this.apiService = new ecs.FargateService(this, 'ApiService', {
      cluster: this.cluster,
      taskDefinition: apiTaskDef,
      serviceName: `capiro-${cfg.envName}-api`,
      desiredCount: cfg.apiDesiredCount,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [serviceSecurityGroup as ec2.SecurityGroup],
      assignPublicIp: false,
      enableExecuteCommand: cfg.envName !== 'prod', // prod uses session manager via separate path
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    const apiScaling = this.apiService.autoScaleTaskCount({
      minCapacity: cfg.apiDesiredCount,
      maxCapacity: cfg.apiMaxCount,
    });
    apiScaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(30),
    });

    // ------------------------------------------------------------------ Web task definition + service
    const webTaskDef = new ecs.FargateTaskDefinition(this, 'WebTaskDef', {
      family: `capiro-${cfg.envName}-web`,
      cpu: cfg.webCpu,
      memoryLimitMiB: cfg.webMemoryMib,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      taskRole: webTaskRole,
    });

    grantSecretsAndKmsToExecutionRole(
      webTaskDef,
      [clerkPubKeyImported.secretArn],
      [secretsStack.secretsKey.keyArn],
    );

    webTaskDef.addContainer('web', {
      image: ecs.ContainerImage.fromEcrRepository(this.webRepo, 'latest'),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup: webLogGroup, streamPrefix: 'web' }),
      environment: {
        // Read by the web container's entrypoint to generate /runtime-config.js
        // at boot. Same image promotes through environments.
        APP_ENV: cfg.envName,
        API_BASE_URL: `https://${cfg.appHost}`,
      },
      secrets: {
        CLERK_PUBLISHABLE_KEY: ecs.Secret.fromSecretsManager(clerkPubKeyImported),
      },
      readonlyRootFilesystem: false, // nginx writes pid/temp files; locked down via tmpfs in Dockerfile
      portMappings: [{ containerPort: 8080, protocol: ecs.Protocol.TCP }],
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://127.0.0.1:8080/healthz || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(15),
      },
    });

    this.webService = new ecs.FargateService(this, 'WebService', {
      cluster: this.cluster,
      taskDefinition: webTaskDef,
      serviceName: `capiro-${cfg.envName}-web`,
      desiredCount: cfg.webDesiredCount,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [serviceSecurityGroup as ec2.SecurityGroup],
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    const webScaling = this.webService.autoScaleTaskCount({
      minCapacity: cfg.webDesiredCount,
      maxCapacity: cfg.webMaxCount,
    });
    webScaling.scaleOnCpuUtilization('CpuScaling', { targetUtilizationPercent: 60 });

    // ------------------------------------------------------------------ Marketing task definition + service
    // Static landing page served by nginx at the apex `capiro.ai`. Same
    // hardening profile as the web container.
    const marketingLogGroup = new logs.LogGroup(this, 'MarketingLogs', {
      logGroupName: `/capiro/${cfg.envName}/marketing`,
      retention: cfg.logRetentionDays as unknown as logs.RetentionDays,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const marketingTaskRole = new iam.Role(this, 'MarketingTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Capiro marketing task role',
    });

    const marketingTaskDef = new ecs.FargateTaskDefinition(this, 'MarketingTaskDef', {
      family: `capiro-${cfg.envName}-marketing`,
      cpu: cfg.marketingCpu,
      memoryLimitMiB: cfg.marketingMemoryMib,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      taskRole: marketingTaskRole,
    });

    this.marketingRepo = ecr.Repository.fromRepositoryName(
      this,
      'MarketingRepo',
      `capiro/${cfg.envName}/marketing`,
    );

    marketingTaskDef.addContainer('marketing', {
      image: ecs.ContainerImage.fromEcrRepository(this.marketingRepo, 'latest'),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup: marketingLogGroup, streamPrefix: 'marketing' }),
      readonlyRootFilesystem: false,
      portMappings: [{ containerPort: 8080, protocol: ecs.Protocol.TCP }],
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://127.0.0.1:8080/healthz || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(15),
      },
    });

    this.marketingService = new ecs.FargateService(this, 'MarketingService', {
      cluster: this.cluster,
      taskDefinition: marketingTaskDef,
      serviceName: `capiro-${cfg.envName}-marketing`,
      desiredCount: cfg.marketingDesiredCount,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [serviceSecurityGroup as ec2.SecurityGroup],
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    const marketingScaling = this.marketingService.autoScaleTaskCount({
      minCapacity: cfg.marketingDesiredCount,
      maxCapacity: cfg.marketingMaxCount,
    });
    marketingScaling.scaleOnCpuUtilization('MarketingCpuScaling', {
      targetUtilizationPercent: 60,
    });

    // ------------------------------------------------------------------ Migration task (run manually before API rollout)
    this.apiMigrateTaskDefinition = new ecs.FargateTaskDefinition(this, 'ApiMigrateTaskDef', {
      family: `capiro-${cfg.envName}-api-migrate`,
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      taskRole: apiTaskRole,
    });
    grantSecretsAndKmsToExecutionRole(
      this.apiMigrateTaskDefinition,
      [
        dbSecretImported.secretArn,
        clerkSecretKeyImported.secretArn,
        clerkWebhookImported.secretArn,
      ],
      [dataKey.keyArn, secretsStack.secretsKey.keyArn],
    );
    this.apiMigrateTaskDefinition.addContainer('api-migrate', {
      image: ecs.ContainerImage.fromEcrRepository(this.apiRepo, 'latest'),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup: migrateLogGroup, streamPrefix: 'migrate' }),
      command: ['migrate'],
      environment: { ...apiSharedEnv, MIGRATE_ONLY: '1' },
      secrets: apiMigrateSecrets,
      readonlyRootFilesystem: false,
    });

    // -------------------------------------------------------- bootstrap-roles task
    // One-shot task that connects to Aurora as the master role and
    // ALTER ROLEs `capiro_app` to whatever password is currently in the
    // app secret. Run after every change to the app secret (rotation,
    // initial bootstrap). Identity grants are the same as the migrate
    // task — both need to talk to the DB.
    this.apiBootstrapRolesTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      'ApiBootstrapRolesTaskDef',
      {
        family: `capiro-${cfg.envName}-api-bootstrap-roles`,
        cpu: 256,
        memoryLimitMiB: 512,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
        taskRole: apiTaskRole,
      },
    );
    grantSecretsAndKmsToExecutionRole(
      this.apiBootstrapRolesTaskDefinition,
      [dbSecretImported.secretArn, appDbSecretImported.secretArn],
      [dataKey.keyArn],
    );
    this.apiBootstrapRolesTaskDefinition.addContainer('api-bootstrap-roles', {
      image: ecs.ContainerImage.fromEcrRepository(this.apiRepo, 'latest'),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: migrateLogGroup,
        streamPrefix: 'bootstrap-roles',
      }),
      command: ['bootstrap-roles'],
      environment: apiSharedEnv,
      // The bootstrap-roles script reads master + app credentials from env.
      // The container's entrypoint already composes DATABASE_URL from DB_*,
      // but bootstrap-roles uses MASTER_*/APP_* explicitly to keep the two
      // credentials clearly named.
      secrets: {
        DB_HOST: ecs.Secret.fromSecretsManager(dbSecretImported, 'host'),
        DB_PORT: ecs.Secret.fromSecretsManager(dbSecretImported, 'port'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecretImported, 'password'),
        DB_USER: ecs.Secret.fromSecretsManager(dbSecretImported, 'username'),
        MASTER_USER: ecs.Secret.fromSecretsManager(dbSecretImported, 'username'),
        MASTER_PASSWORD: ecs.Secret.fromSecretsManager(dbSecretImported, 'password'),
        APP_USER: ecs.Secret.fromSecretsManager(appDbSecretImported, 'username'),
        APP_PASSWORD: ecs.Secret.fromSecretsManager(appDbSecretImported, 'password'),
      },
      readonlyRootFilesystem: false,
    });

    // ------------------------------------------------------------------ ALB + listeners
    this.alb = new elb.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup as ec2.SecurityGroup,
      ipAddressType: elb.IpAddressType.IPV4,
      dropInvalidHeaderFields: true,
      deletionProtection: cfg.protectFromDestroy,
      idleTimeout: cdk.Duration.seconds(60),
    });

    // HTTP -> HTTPS redirect.
    this.alb.addListener('HttpRedirect', {
      port: 80,
      protocol: elb.ApplicationProtocol.HTTP,
      defaultAction: elb.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    const httpsListener = this.alb.addListener('Https', {
      port: 443,
      protocol: elb.ApplicationProtocol.HTTPS,
      // Two certs on the listener: the app cert (app.capiro.ai + *.app.capiro.ai)
      // and the apex cert (capiro.ai + www). ALB picks the right one per
      // SNI handshake. Listed as L2 props so CDK creates the
      // ListenerCertificates association.
      certificates: [certificate, apexCertificate],
      sslPolicy: elb.SslPolicy.RECOMMENDED_TLS,
      defaultAction: elb.ListenerAction.fixedResponse(404, {
        contentType: 'text/plain',
        messageBody: 'Not found',
      }),
    });

    this.apiTargetGroup = new elb.ApplicationTargetGroup(this, 'ApiTargetGroup', {
      vpc,
      port: 4000,
      protocol: elb.ApplicationProtocol.HTTP,
      targetType: elb.TargetType.IP,
      targets: [this.apiService.loadBalancerTarget({ containerName: 'api', containerPort: 4000 })],
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        unhealthyThresholdCount: 3,
        healthyThresholdCount: 2,
      },
      deregistrationDelay: cdk.Duration.seconds(15),
      stickinessCookieDuration: cdk.Duration.minutes(5),
    });

    this.webTargetGroup = new elb.ApplicationTargetGroup(this, 'WebTargetGroup', {
      vpc,
      port: 8080,
      protocol: elb.ApplicationProtocol.HTTP,
      targetType: elb.TargetType.IP,
      targets: [this.webService.loadBalancerTarget({ containerName: 'web', containerPort: 8080 })],
      healthCheck: {
        path: '/healthz',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        unhealthyThresholdCount: 3,
        healthyThresholdCount: 2,
      },
      deregistrationDelay: cdk.Duration.seconds(15),
    });

    this.marketingTargetGroup = new elb.ApplicationTargetGroup(this, 'MarketingTargetGroup', {
      vpc,
      port: 8080,
      protocol: elb.ApplicationProtocol.HTTP,
      targetType: elb.TargetType.IP,
      targets: [
        this.marketingService.loadBalancerTarget({
          containerName: 'marketing',
          containerPort: 8080,
        }),
      ],
      healthCheck: {
        path: '/healthz',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        unhealthyThresholdCount: 3,
        healthyThresholdCount: 2,
      },
      deregistrationDelay: cdk.Duration.seconds(15),
    });

    // Listener rules — ORDER MATTERS, lower priority wins.
    //   5  apex (capiro.ai) → marketing
    //   10 /api/*, /webhooks/*, /health (any host) → api
    //   20 app.capiro.ai + *.app.capiro.ai → web
    //   default → 404 (set on the listener itself)
    httpsListener.addAction('Marketing', {
      priority: 5,
      conditions: [elb.ListenerCondition.hostHeaders([cfg.rootDomain, `www.${cfg.rootDomain}`])],
      action: elb.ListenerAction.forward([this.marketingTargetGroup]),
    });
    httpsListener.addAction('ApiPaths', {
      priority: 10,
      conditions: [elb.ListenerCondition.pathPatterns(['/api/*', '/webhooks/*', '/health'])],
      action: elb.ListenerAction.forward([this.apiTargetGroup]),
    });
    httpsListener.addAction('WebDefault', {
      priority: 20,
      conditions: [elb.ListenerCondition.hostHeaders([cfg.appHost, cfg.wildcardHost])],
      action: elb.ListenerAction.forward([this.webTargetGroup]),
    });

    // ---------------------------------------------------------------- WAF
    const waf = new wafv2.CfnWebACL(this, 'WebAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `capiro-${cfg.envName}-waf`,
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'AWS-AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesCommonRuleSet' },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'BadInputs',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWS-AWSManagedRulesAmazonIpReputationList',
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAmazonIpReputationList',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'IpReputation',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'PerIpRateLimit',
          priority: 10,
          action: { block: {} },
          statement: {
            rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'PerIpRate',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });
    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: this.alb.loadBalancerArn,
      webAclArn: waf.attrArn,
    });

    // ---------------------------------------------------------------- DNS
    new route53.ARecord(this, 'AppAlias', {
      zone: hostedZone,
      recordName: cfg.appHost,
      target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(this.alb)),
    });
    // Wildcard alias for tenant vanity URLs ({slug}.app.capiro.ai).
    new route53.ARecord(this, 'AppWildcardAlias', {
      zone: hostedZone,
      recordName: cfg.wildcardHost,
      target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(this.alb)),
    });
    // Apex `capiro.ai` → marketing site on the same ALB. The pre-existing
    // apex A record (pointing to a stale CloudFront) must be deleted before
    // this deploys; see infra/cdk/README.md.
    new route53.ARecord(this, 'ApexAlias', {
      zone: hostedZone,
      recordName: cfg.rootDomain,
      target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(this.alb)),
    });
    new route53.AaaaRecord(this, 'ApexAliasIpv6', {
      zone: hostedZone,
      recordName: cfg.rootDomain,
      target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(this.alb)),
    });

    new cdk.CfnOutput(this, 'AlbDnsName', { value: this.alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'ApiRepoUri', { value: this.apiRepo.repositoryUri });
    new cdk.CfnOutput(this, 'WebRepoUri', { value: this.webRepo.repositoryUri });
    new cdk.CfnOutput(this, 'ApiServiceArn', { value: this.apiService.serviceArn });
    new cdk.CfnOutput(this, 'ApiMigrateTaskDefArn', {
      value: this.apiMigrateTaskDefinition.taskDefinitionArn,
    });
  }
}

function importExternalSecret(
  scope: Construct,
  id: string,
  secretName: string,
  completeArn?: string,
): secretsmanager.ISecret {
  return completeArn
    ? secretsmanager.Secret.fromSecretCompleteArn(scope, id, completeArn)
    : secretsmanager.Secret.fromSecretNameV2(scope, id, secretName);
}

/**
 * Adds secretsmanager:GetSecretValue + DescribeSecret on the given secret
 * ARNs and kms:Decrypt on the KMS key ARNs to a Fargate task definition's
 * execution role. Necessary when the secrets are IMPORTED constructs (CDK
 * cannot auto-wire KMS perms across stacks for imports).
 */
function grantSecretsAndKmsToExecutionRole(
  taskDef: ecs.FargateTaskDefinition,
  secretArns: string[],
  kmsKeyArns: string[],
): void {
  // The execution role is created lazily by the L2 — accessing it here forces
  // creation. Adding policies before any container is added is fine because
  // the role exists once the task definition is constructed.
  taskDef.addToExecutionRolePolicy(
    new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: secretArns,
    }),
  );
  taskDef.addToExecutionRolePolicy(
    new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:DescribeKey'],
      resources: kmsKeyArns,
    }),
  );
}
