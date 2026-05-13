import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesactions from 'aws-cdk-lib/aws-ses-actions';
import * as path from 'node:path';
import { commonTags, type EnvConfig } from './config';
import type { SecretsStack } from './secrets-stack';

export interface SesStackProps extends cdk.StackProps {
  cfg: EnvConfig;
  /** Hosted zone for the Capiro root domain (capiro.ai / staging.capiro.ai). */
  hostedZone: route53.IHostedZone;
  /** SecretsStack so we can grant Lambda read access to the webhook HMAC key. */
  secretsStack: SecretsStack;
}

/**
 * Per-user Clio email infrastructure.
 *
 * Domain: `clio.<rootDomain>` (e.g. clio.staging.capiro.ai). Distinct
 * from the existing Capiro Microsoft 365 integration — this is Clio's
 * OWN address space, one per user.
 *
 * Flow:
 *   Internet → Route53 MX → SES inbound → S3 bucket → Lambda → POST to API
 *
 * SES domain verification is the one piece CDK can't fully automate
 * because AWS won't accept a verification request until the DNS
 * records exist, and the DNS records depend on the SES identity to
 * tell us what tokens to publish. We work around this by:
 *   1. Creating the EmailIdentity CDK construct (which creates the
 *      identity in pending state + sets up DKIM CNAMEs automatically).
 *   2. CDK also adds the MX + SPF + DMARC TXT records.
 *   3. AWS automatically polls and flips the identity to "verified"
 *      once the DKIM CNAMEs propagate (~minutes to a few hours).
 *
 * Receipt rule set + lambda activation: SES receipt rule sets are
 * account-wide, exactly one can be "active" at a time. We create one
 * named after the env. If you already have one active, this stack will
 * fail — see README for handling.
 */
export class SesStack extends cdk.Stack {
  public readonly inboundBucket: s3.Bucket;
  public readonly parserFunction: lambda.Function;
  public readonly emailIdentity: ses.EmailIdentity;
  public readonly mailDomain: string;

  constructor(scope: Construct, id: string, props: SesStackProps) {
    super(scope, id, props);
    const { cfg, hostedZone, secretsStack } = props;

    Object.entries(commonTags(cfg)).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    // ----------------------------------------------------------------
    // Mail domain. `clio.` prefix on whatever the env's appHost host
    // family is. Lives in the same hosted zone so DNS changes flow
    // through one CDK stack.
    this.mailDomain = `clio.${cfg.rootDomain}`;

    // ----------------------------------------------------------------
    // S3 bucket for raw inbound MIME blobs. SES writes objects under
    // `inbound/<message-id>` (we set this as the prefix on the receipt
    // rule below). 30-day lifecycle so a quiet inbox doesn't accumulate
    // storage forever.
    this.inboundBucket = new s3.Bucket(this, 'InboundMailBucket', {
      bucketName: `capiro-${cfg.envName}-clio-inbound-mail`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        {
          // Retain raw mail for 30 days then purge. The structured
          // ClioInboundMail row stays in Postgres indefinitely; the
          // raw blob is forensic-only.
          id: 'expire-inbound-after-30d',
          expiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: cfg.protectFromDestroy
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !cfg.protectFromDestroy,
    });

    // SES needs s3:PutObject on this bucket to drop received mail. Allow
    // it via a resource-based policy scoped to the SES service principal
    // + this AWS account (defense against confused-deputy).
    this.inboundBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSesPutObject',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [`${this.inboundBucket.bucketArn}/*`],
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
        },
      }),
    );

    // ----------------------------------------------------------------
    // Lambda parser. Reads the raw S3 object, parses MIME, signs +
    // forwards to the Capiro API webhook. NodejsFunction would bundle
    // deps automatically but pulling esbuild into the worktree adds
    // friction; we use a plain `Function` and bundle by hand instead.
    // The Lambda code lives under infra/lambdas/clio-inbound-mail/.
    const lambdaLogGroup = new logs.LogGroup(this, 'ParserLogGroup', {
      logGroupName: `/capiro/${cfg.envName}/clio-inbound-mail`,
      retention: cfg.envName === 'prod'
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cfg.protectFromDestroy
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // Import the webhook secret + KMS key by ARN to avoid the
    // cross-stack reference cycle that grant* would otherwise
    // introduce. Same pattern compute-stack.ts uses for the Clio
    // inbound shared secret.
    const webhookSecretImported = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'ImportedMailWebhookSecret',
      secretsStack.clioMailWebhookSecret.secretArn,
    );

    this.parserFunction = new lambda.Function(this, 'ParserFunction', {
      functionName: `capiro-${cfg.envName}-clio-inbound-mail`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      // The directory must contain `node_modules/` already because we're
      // not bundling. Operator runs `npm ci` in
      // infra/lambdas/clio-inbound-mail/ before `cdk deploy`. The
      // README documents this.
      // `__dirname` resolves at runtime under CDK's CommonJS module
      // mode. Path relative to lib/ → ../../lambdas/clio-inbound-mail.
      code: lambda.Code.fromAsset(
        path.join(__dirname, '..', '..', 'lambdas', 'clio-inbound-mail'),
      ),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logGroup: lambdaLogGroup,
      environment: {
        CLIO_MAIL_WEBHOOK_URL: `https://${cfg.appHost}/webhooks/clio-mail`,
        CLIO_MAIL_WEBHOOK_SECRET_ARN: webhookSecretImported.secretArn,
        CLIO_MAIL_DOMAIN: this.mailDomain,
      },
    });

    this.inboundBucket.grantRead(this.parserFunction);
    webhookSecretImported.grantRead(this.parserFunction);
    // Inline KMS Decrypt for the secrets CMK — granting via the
    // imported key would also re-introduce the cycle. The CMK ARN is
    // exported by SecretsStack so we can attach a fresh PolicyStatement
    // here without forcing the cross-stack ref into the SecretsStack
    // template.
    this.parserFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: [secretsStack.secretsKey.keyArn],
      }),
    );

    // Wire S3 PutObject → Lambda. Prefix-scoped to the inbound/ key
    // namespace SES writes into so test uploads to other prefixes
    // don't accidentally fire the Lambda.
    this.inboundBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.parserFunction),
      { prefix: 'inbound/' },
    );

    // ----------------------------------------------------------------
    // SES email identity for `clio.<rootDomain>`. We use Identity.domain
    // (not publicHostedZone) because the hosted zone is for the root
    // domain and we want the SES identity to be the subdomain. EasyDKIM
    // is enabled by default; the three CNAME tokens are exposed via
    // `dkimRecords` and we publish them into the same hosted zone
    // below — same end state as publicHostedZone() would give us, just
    // for a subdomain.
    this.emailIdentity = new ses.EmailIdentity(this, 'ClioDomain', {
      identity: ses.Identity.domain(this.mailDomain),
    });

    // Publish the three DKIM CNAMEs SES needs to flip the identity to
    // VERIFIED. Records look like:
    //   <token>._domainkey.clio.<rootDomain>. CNAME <token>.dkim.amazonses.com.
    //
    // CDK's Route53 record constructs append the zone domain when
    // recordName doesn't end with a dot — so passing the SES-returned
    // absolute name as-is would produce a doubled
    // `..._domainkey.clio.<root>.<root>` record. We append a trailing
    // dot to mark the name as already-fully-qualified.
    this.emailIdentity.dkimRecords.forEach((r, i) => {
      new route53.CnameRecord(this, `ClioDkim${i}`, {
        zone: hostedZone,
        recordName: r.name.endsWith('.') ? r.name : `${r.name}.`,
        domainName: r.value,
        ttl: cdk.Duration.minutes(30),
      });
    });

    // ----------------------------------------------------------------
    // DNS: MX, SPF, DMARC. DKIM CNAMEs are emitted by EmailIdentity
    // automatically when dkimRecords is iterated; we publish them
    // explicitly so cdk diff is informative.
    const inboundEndpoint = `inbound-smtp.${this.region}.amazonaws.com`;

    new route53.MxRecord(this, 'ClioMx', {
      zone: hostedZone,
      recordName: this.mailDomain, // clio.<rootDomain>
      values: [{ priority: 10, hostName: inboundEndpoint }],
      ttl: cdk.Duration.minutes(30),
    });

    // SPF: allow only AWS SES (amazonses.com include).
    new route53.TxtRecord(this, 'ClioSpf', {
      zone: hostedZone,
      recordName: this.mailDomain,
      values: ['v=spf1 include:amazonses.com -all'],
      ttl: cdk.Duration.minutes(30),
    });

    // DMARC: quarantine misaligned mail, aggregate reports to a
    // mailbox the user controls. Initial policy is `quarantine` not
    // `reject` so misconfigurations don't silently drop legitimate
    // outbound while we shake the setup out.
    new route53.TxtRecord(this, 'ClioDmarc', {
      zone: hostedZone,
      recordName: `_dmarc.${this.mailDomain}`,
      values: [
        `v=DMARC1; p=quarantine; rua=mailto:dmarc@${cfg.rootDomain}; ruf=mailto:dmarc@${cfg.rootDomain}; fo=1; aspf=s; adkim=s`,
      ],
      ttl: cdk.Duration.minutes(30),
    });

    // ----------------------------------------------------------------
    // SES receipt rule set. ONE rule: accept everything @ the mail
    // domain, write to S3 under inbound/, no other actions. The
    // Lambda fires from the S3 PUT.
    //
    // SES requires the rule set name be unique account-wide, and only
    // one rule set can be active at a time across the account. We
    // create it but DO NOT call setActiveReceiptRuleSet — that's a
    // manual one-time step (`aws ses set-active-receipt-rule-set`)
    // because it's destructive of any rule set already active.
    const ruleSet = new ses.ReceiptRuleSet(this, 'ClioRuleSet', {
      receiptRuleSetName: `capiro-${cfg.envName}-clio-mail`,
    });

    ruleSet.addRule('AcceptAll', {
      recipients: [this.mailDomain], // catches every <anything>@<mailDomain>
      enabled: true,
      scanEnabled: false, // SES virus + spam scanning skipped for staging speed
      tlsPolicy: ses.TlsPolicy.OPTIONAL,
      actions: [
        new sesactions.S3({
          bucket: this.inboundBucket,
          objectKeyPrefix: 'inbound/',
        }),
      ],
    });

    // ----------------------------------------------------------------
    // Outputs — pin the bucket name and the rule set name for the
    // operator runbook.
    new cdk.CfnOutput(this, 'InboundBucketName', {
      value: this.inboundBucket.bucketName,
      exportName: `Capiro-${cfg.envName}-ClioInboundBucketName`,
    });
    new cdk.CfnOutput(this, 'MailDomain', {
      value: this.mailDomain,
      exportName: `Capiro-${cfg.envName}-ClioMailDomain`,
    });
    new cdk.CfnOutput(this, 'ReceiptRuleSetName', {
      value: `capiro-${cfg.envName}-clio-mail`,
      description:
        'After deploy, activate this rule set via: aws ses set-active-receipt-rule-set --rule-set-name capiro-<env>-clio-mail',
    });
    new cdk.CfnOutput(this, 'ParserFunctionArn', {
      value: this.parserFunction.functionArn,
    });
  }
}
