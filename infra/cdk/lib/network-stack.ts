import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { commonTags, type EnvConfig } from './config';

export interface NetworkStackProps extends cdk.StackProps {
  cfg: EnvConfig;
}

/**
 * VPC + subnets + NAT + VPC endpoints. Three AZs for HA.
 *
 * Subnet tiers:
 *   - public:    ALB + NAT gateways
 *   - private:   ECS Fargate tasks (egress via NAT for LLM provider calls)
 *   - isolated:  Aurora Serverless v2 (no internet, ever)
 *
 * VPC endpoints keep tenant payloads off the public internet for AWS service
 * traffic (S3, ECR, Secrets Manager, KMS, CloudWatch Logs). LLM provider
 * traffic (Anthropic, OpenAI) still goes through NAT — the network firewall
 * allowlist for those endpoints lands in a SecurityStack later.
 */
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly serviceSecurityGroup: ec2.SecurityGroup;
  public readonly dbSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { cfg } = props;

    Object.entries(commonTags(cfg)).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.40.0.0/16'),
      maxAzs: 3,
      natGateways: cfg.envName === 'prod' ? 3 : 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      // VPC flow logs to CloudWatch — required for SOC 2 network visibility.
      flowLogs: {
        all: {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(
            new logs.LogGroup(this, 'VpcFlowLogs', {
              retention: logs.RetentionDays.ONE_YEAR,
              removalPolicy: cfg.protectFromDestroy
                ? cdk.RemovalPolicy.RETAIN
                : cdk.RemovalPolicy.DESTROY,
            }),
          ),
          trafficType: ec2.FlowLogTrafficType.REJECT,
        },
      },
    });

    // ALB SG — open to the world on 443/80; 80 redirects to 443 in ComputeStack.
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      description: 'Capiro ALB ingress',
      allowAllOutbound: true,
    });
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS from internet',
    );
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP redirect to HTTPS',
    );

    // ECS service SG — only the ALB can reach the task ports.
    this.serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSg', {
      vpc: this.vpc,
      description: 'Capiro ECS Fargate tasks',
      allowAllOutbound: true,
    });
    this.serviceSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcpRange(3000, 9000),
      'ALB to ECS tasks',
    );

    // Aurora SG — only ECS tasks can reach 5432.
    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: this.vpc,
      description: 'Capiro Aurora ingress',
      allowAllOutbound: false,
    });
    this.dbSecurityGroup.addIngressRule(
      this.serviceSecurityGroup,
      ec2.Port.tcp(5432),
      'ECS tasks to Aurora Postgres',
    );

    // Gateway endpoint for S3 — free, route-table based.
    this.vpc.addGatewayEndpoint('S3Gateway', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // Interface endpoints — billed per-AZ-hour, but keep tenant payloads
    // off the public internet for AWS service traffic.
    const interfaceEndpoints: Array<[string, ec2.InterfaceVpcEndpointAwsService]> = [
      ['EcrApi', ec2.InterfaceVpcEndpointAwsService.ECR],
      ['EcrDkr', ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER],
      ['SecretsManager', ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER],
      ['Kms', ec2.InterfaceVpcEndpointAwsService.KMS],
      ['CloudWatchLogs', ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS],
      ['Sts', ec2.InterfaceVpcEndpointAwsService.STS],
    ];
    for (const [id, service] of interfaceEndpoints) {
      this.vpc.addInterfaceEndpoint(id, {
        service,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        privateDnsEnabled: true,
        securityGroups: [this.serviceSecurityGroup],
      });
    }

    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
  }
}
