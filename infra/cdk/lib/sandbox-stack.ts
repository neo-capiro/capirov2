import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { commonTags, type EnvConfig } from './config';
import type { AssetsStack } from './assets-stack';
import type { SecretsStack } from './secrets-stack';

export interface SandboxStackProps extends cdk.StackProps {
  cfg: EnvConfig;
  vpc: ec2.IVpc;
  serviceSecurityGroup: ec2.ISecurityGroup;
  cluster: ecs.ICluster;
  /** Cloud Map namespace ClioStack already created for `capiro-{env}.local`. */
  cloudMapNamespace: servicediscovery.IPrivateDnsNamespace;
  assetsStack: AssetsStack;
  secretsStack: SecretsStack;
}

/**
 * Clio code-execution sandbox — Python service that runs untrusted user-
 * submitted code with rlimits and writes file outputs to S3 under
 * `tenants/<tenantId>/clio-runs/<runId>/<filename>`.
 *
 * Lives in a separate Fargate task from `clio` deliberately: a compromise
 * in user-supplied Python must not steal Bedrock keys, the Clio shared
 * secret, or any DB access. The sandbox's IAM role is restricted to
 * exactly `s3:PutObject` on the artifact prefix + `GetSecretValue` on
 * the shared bearer secret.
 *
 * Reachable from the Capiro API at `http://clio-sandbox.capiro-{env}.local:8001`
 * via the same Cloud Map private DNS namespace ClioStack registered.
 * No public ingress; egress is allowed (NAT gateway in the existing
 * private-with-egress subnets) so the user's Python can pull from
 * public APIs / GitHub / S3.
 *
 * See OVERNIGHT_DECISIONS_CODE_EXEC.md §16 for the design.
 */
export class SandboxStack extends cdk.Stack {
  public readonly service: ecs.FargateService;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly repository: ecr.IRepository;

  constructor(scope: Construct, id: string, props: SandboxStackProps) {
    super(scope, id, props);
    const {
      cfg,
      vpc,
      serviceSecurityGroup,
      cluster,
      cloudMapNamespace,
      assetsStack,
      secretsStack,
    } = props;

    Object.entries(commonTags(cfg)).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    // ECR repo is created out-of-band (one-shot `aws ecr create-repository`)
    // because the Fargate service in this stack references a `:latest`
    // tag that has to exist BEFORE the service can roll out. Same pattern
    // ClioStack uses for `capiro/<env>/clio`. Lifecycle (keep N images)
    // is set on the repo creation script.
    this.repository = ecr.Repository.fromRepositoryName(
      this,
      'SandboxRepo',
      `capiro/${cfg.envName}/clio-sandbox`,
    );

    const logGroup = new logs.LogGroup(this, 'SandboxLogs', {
      logGroupName: `/capiro/${cfg.envName}/clio-sandbox`,
      retention: cfg.logRetentionDays as unknown as logs.RetentionDays,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'SandboxTaskDef', {
      family: `capiro-${cfg.envName}-clio-sandbox`,
      // 0.25 vCPU / 512MB is enough for spawning a Python subprocess
      // with rlimit 512MB. Code-execution subprocesses don't share
      // memory with the parent FastAPI server — rlimit is on the child,
      // the parent holds the FastAPI + boto3 client.
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Scoped IAM: PutObject (and GetObject for caller-supplied input
    // files in future) under tenants/*/clio-runs/* only. NO Bedrock,
    // NO database, NO other secrets. Compromise of user-submitted
    // Python can write artifacts to the legitimate output prefix and
    // nothing else.
    this.taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        sid: 'SandboxArtifactsWrite',
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: [`${assetsStack.bucket.bucketArn}/tenants/*/clio-runs/*`],
      }),
    );
    // Sign presigned-GET URLs returned to the model. Needs ListBucket
    // for the bucket-level location call boto makes during sigv4
    // initialization.
    this.taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        sid: 'SandboxBucketHead',
        actions: ['s3:GetBucketLocation'],
        resources: [assetsStack.bucket.bucketArn],
      }),
    );

    // The assets bucket is KMS-encrypted with assetsStack.key. PutObject
    // and GetObject against it need GenerateDataKey + Decrypt on that
    // CMK — without these the S3 call fails with `AccessDenied` from
    // KMS, NOT S3, which is confusing in logs.
    this.taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        sid: 'SandboxAssetsKmsAccess',
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: [assetsStack.key.keyArn],
      }),
    );

    // Inbound shared secret — same bearer the API/Clio use. The
    // sandbox validates the bearer on every /run so a compromised
    // task in the VPC can't drive the sandbox without the secret.
    const sharedSecretImported = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'ImportedSharedSecret',
      secretsStack.clioInboundSharedSecret.secretArn,
    );

    // KMS decrypt for the secret. Inline (not grantDecrypt) to avoid
    // re-introducing the SecretsStack ↔ this stack cycle.
    this.taskDefinition.addToExecutionRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: [secretsStack.secretsKey.keyArn],
      }),
    );

    this.taskDefinition.addContainer('clio-sandbox', {
      image: ecs.ContainerImage.fromEcrRepository(this.repository, 'latest'),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'sandbox' }),
      environment: {
        SANDBOX_BIND_HOST: '0.0.0.0',
        SANDBOX_BIND_PORT: '8001',
        SANDBOX_LOG_LEVEL: 'INFO',
        SANDBOX_ASSETS_BUCKET: assetsStack.bucket.bucketName,
        SANDBOX_ASSETS_REGION: this.region,
        // Match the sandbox rlimits to the task's memory ceiling minus
        // overhead. 512MB child cap, 30s wall-clock, 50MB output cap
        // — these are sandbox defaults and match the design spec.
        SANDBOX_RUN_TIMEOUT_SECONDS: '30',
        SANDBOX_RUN_MEMORY_MB: '512',
      },
      secrets: {
        SANDBOX_INBOUND_SHARED_SECRET: ecs.Secret.fromSecretsManager(sharedSecretImported),
      },
      portMappings: [{ containerPort: 8001, protocol: ecs.Protocol.TCP }],
      healthCheck: {
        command: [
          'CMD-SHELL',
          "python -c \"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/healthz', timeout=3).status == 200 else 1)\" || exit 1",
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(20),
      },
      // The runner writes to a per-request tempdir under /tmp; readonly
      // root with /tmp mounted as a writable volume would be tighter
      // but adds complexity without a clear win since the rlimited
      // child is what we're actually defending against.
      readonlyRootFilesystem: false,
    });

    this.service = new ecs.FargateService(this, 'SandboxService', {
      cluster,
      taskDefinition: this.taskDefinition,
      serviceName: `capiro-${cfg.envName}-clio-sandbox`,
      desiredCount: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [serviceSecurityGroup as ec2.SecurityGroup],
      assignPublicIp: false,
      enableExecuteCommand: cfg.envName !== 'prod',
      circuitBreaker: { rollback: true },
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
      cloudMapOptions: {
        name: 'clio-sandbox',
        cloudMapNamespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(10),
      },
    });

    // API → sandbox on 8001. Same self-referential pattern ClioStack
    // uses for 8000. Same SG, so the rule is effectively "any task in
    // this SG can reach 8001 on any other task in this SG".
    this.service.connections.allowFrom(
      serviceSecurityGroup,
      ec2.Port.tcp(8001),
      'Capiro API to Clio sandbox (port 8001)',
    );

    new cdk.CfnOutput(this, 'SandboxServiceArn', { value: this.service.serviceArn });
    new cdk.CfnOutput(this, 'SandboxRepoUri', { value: this.repository.repositoryUri });
    new cdk.CfnOutput(this, 'SandboxLogGroup', { value: logGroup.logGroupName });
    new cdk.CfnOutput(this, 'SandboxInternalUrl', {
      value: `http://clio-sandbox.capiro-${cfg.envName}.local:8001`,
      description:
        'Set this as CLIO_SANDBOX_BASE_URL on the API task to activate the code_interpreter tool.',
    });
  }
}
