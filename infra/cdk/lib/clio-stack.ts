import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { commonTags, type EnvConfig } from './config';

export interface ClioStackProps extends cdk.StackProps {
  cfg: EnvConfig;
  vpc: ec2.IVpc;
  serviceSecurityGroup: ec2.ISecurityGroup;
  cluster: ecs.ICluster;
}

/**
 * Clio agent runtime — separate Fargate service hosting the Python agent
 * loop that calls Bedrock. Runs in the same ECS cluster as the API/web/
 * marketing services for cost (one cluster) and operational (single VPC,
 * single set of CW dashboards) reasons, but its task definition is fully
 * isolated: its own IAM roles, log group, ECR repo.
 *
 * Phase 0 — no ALB, no Service Connect, no public ingress. Reachable only
 * by other tasks in the same VPC at the task's private IP. Step 4 wires
 * the Capiro API to it via Service Connect or an internal ALB.
 *
 * Bedrock perms are scoped to the cross-region inference profiles that
 * are ACTIVE in the account. Using `*` for the model id wildcard would
 * grant access to any future-published model — not what we want for SOC 2.
 */
export class ClioStack extends cdk.Stack {
  public readonly service: ecs.FargateService;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly repository: ecr.IRepository;

  constructor(scope: Construct, id: string, props: ClioStackProps) {
    super(scope, id, props);
    const { cfg, vpc, serviceSecurityGroup, cluster } = props;

    Object.entries(commonTags(cfg)).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    this.repository = ecr.Repository.fromRepositoryName(
      this,
      'ClioRepo',
      `capiro/${cfg.envName}/clio`,
    );

    // Private DNS namespace shared with the rest of the Capiro VPC. The
    // API task resolves Clio at `clio.capiro-{env}.local` — this only
    // resolves inside the VPC, never from the public internet.
    const namespace = new servicediscovery.PrivateDnsNamespace(this, 'ClioNamespace', {
      name: `capiro-${cfg.envName}.local`,
      vpc,
      description: `Private service discovery for Capiro ${cfg.envName}`,
    });

    const logGroup = new logs.LogGroup(this, 'ClioLogs', {
      logGroupName: `/capiro/${cfg.envName}/clio`,
      retention: cfg.logRetentionDays as unknown as logs.RetentionDays,
      // RETAIN even in non-prod: when Bedrock IAM or VPC endpoint config
      // is wrong on first deploy, the task crashes before stdout flushes —
      // keeping the log group across rollbacks preserves the trail.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'ClioTaskDef', {
      family: `capiro-${cfg.envName}-clio`,
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Bedrock invoke + cross-region inference. Inference profiles route
    // requests across us-east-1, us-east-2, us-west-2 — the IAM policy
    // must permit the underlying foundation models in every routed region,
    // not just the inference profile arn itself.
    this.taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        sid: 'BedrockInvoke',
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:Converse', 'bedrock:ConverseStream'],
        resources: [
          // Cross-region inference profiles (us.* prefix) and their
          // underlying foundation models in any region they route to.
          `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`,
          `arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.claude-*`,
          `arn:aws:bedrock:*:${this.account}:application-inference-profile/*`,
        ],
      }),
    );

    // After the Anthropic use-case form is submitted, Bedrock auto-subscribes
    // the AWS account to the model via AWS Marketplace on first invocation.
    // The Marketplace subscription is account-wide (not per-role) but the
    // first invocation needs these verbs to TRIGGER the subscription handshake;
    // subsequent invocations from any role don't. Resource is "*" because
    // Marketplace's ViewSubscriptions / Subscribe verbs don't take a resource
    // ARN — IAM rejects anything narrower.
    this.taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        sid: 'BedrockMarketplaceAutoSubscribe',
        actions: ['aws-marketplace:ViewSubscriptions', 'aws-marketplace:Subscribe', 'aws-marketplace:Unsubscribe'],
        resources: ['*'],
      }),
    );

    this.taskDefinition.addContainer('clio', {
      image: ecs.ContainerImage.fromEcrRepository(this.repository, 'latest'),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'clio' }),
      environment: {
        CLIO_BEDROCK_REGION: this.region,
        CLIO_BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
        CLIO_LOG_LEVEL: 'INFO',
      },
      portMappings: [{ containerPort: 8000, protocol: ecs.Protocol.TCP }],
      healthCheck: {
        command: [
          'CMD-SHELL',
          // Same /healthz the Dockerfile HEALTHCHECK uses — keeps the
          // ECS task health and the future ALB target group health in sync.
          "python -c \"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3).status == 200 else 1)\" || exit 1",
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(20),
      },
      readonlyRootFilesystem: false, // uvicorn workers may write to /tmp; tighten in Phase 1
    });

    this.service = new ecs.FargateService(this, 'ClioService', {
      cluster,
      taskDefinition: this.taskDefinition,
      serviceName: `capiro-${cfg.envName}-clio`,
      desiredCount: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [serviceSecurityGroup as ec2.SecurityGroup],
      assignPublicIp: false,
      enableExecuteCommand: cfg.envName !== 'prod',
      circuitBreaker: { rollback: true },
      minHealthyPercent: 0, // single-task service; rolling deploy goes 0→1
      maxHealthyPercent: 200,
      // Register the running task in Cloud Map at `clio.capiro-{env}.local`.
      // The DNS record resolves to the task's private IP and refreshes
      // automatically on rolling deploys. A-record TTL of 10s keeps stale
      // routes short during deploys without spamming Route53 queries.
      cloudMapOptions: {
        name: 'clio',
        cloudMapNamespace: namespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(10),
      },
    });

    // The serviceSecurityGroup was already configured by NetworkStack to
    // allow ALB → service traffic on the existing listener ports. The
    // API task lives in the same SG, so adding a self-referential ingress
    // here lets api → clio reach 8000 without widening the SG to the
    // whole VPC.
    this.service.connections.allowFrom(
      serviceSecurityGroup,
      ec2.Port.tcp(8000),
      // SG rule descriptions must be ASCII (a-zA-Z0-9 plus a small set of
      // punctuation); arrows / unicode get rejected by EC2 with a 400.
      'Capiro API to Clio runtime (port 8000)',
    );

    new cdk.CfnOutput(this, 'ClioServiceArn', { value: this.service.serviceArn });
    new cdk.CfnOutput(this, 'ClioRepoUri', { value: this.repository.repositoryUri });
    new cdk.CfnOutput(this, 'ClioLogGroup', { value: logGroup.logGroupName });
    new cdk.CfnOutput(this, 'ClioInternalUrl', {
      // Hardcoded to match the Cloud Map registration above; ComputeStack
      // injects this string into the API task as CLIO_BASE_URL.
      value: `http://clio.capiro-${cfg.envName}.local:8000`,
    });
  }
}
