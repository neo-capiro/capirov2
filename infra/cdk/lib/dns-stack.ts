import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { commonTags, type EnvConfig } from './config';

export interface DnsStackProps extends cdk.StackProps {
  cfg: EnvConfig;
}

/**
 * DNS + TLS for Capiro.
 *
 * The capiro.ai hosted zone already exists in this AWS account. We do NOT
 * mutate the apex — only add records under app.capiro.ai. The cert covers
 * `app.capiro.ai` and `*.app.capiro.ai`, where the wildcard handles tenant
 * vanity URLs (`acmelobby.app.capiro.ai`).
 *
 * The actual A/AAAA records pointing at the ALB are created in ComputeStack
 * because they need the ALB reference. This stack is just the cert + zone
 * lookup so other stacks can `fromCertificateArn(...)` and `fromHostedZone`.
 */
export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.IHostedZone;
  public readonly certificate: acm.ICertificate;
  public readonly apexCertificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);
    const { cfg } = props;

    Object.entries(commonTags(cfg)).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    this.hostedZone = route53.HostedZone.fromLookup(this, 'RootZone', {
      domainName: cfg.rootDomain,
    });

    // App certificate covers app.capiro.ai + tenant vanity URLs.
    this.certificate = new acm.Certificate(this, 'AppCert', {
      domainName: cfg.appHost,
      subjectAlternativeNames: [cfg.wildcardHost],
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    // Separate certificate for the apex `capiro.ai` (and `www.`). Kept as a
    // distinct cert rather than a SAN on the app cert so changes to the apex
    // (e.g. adding www) don't force a replacement of the live app cert,
    // which the ALB listener references cross-stack.
    this.apexCertificate = new acm.Certificate(this, 'ApexCert', {
      domainName: cfg.rootDomain,
      subjectAlternativeNames: [`www.${cfg.rootDomain}`],
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    new cdk.CfnOutput(this, 'CertificateArn', { value: this.certificate.certificateArn });
    new cdk.CfnOutput(this, 'ApexCertificateArn', { value: this.apexCertificate.certificateArn });
    new cdk.CfnOutput(this, 'HostedZoneId', { value: this.hostedZone.hostedZoneId });
  }
}
