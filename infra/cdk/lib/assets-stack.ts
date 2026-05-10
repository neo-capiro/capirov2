import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { commonTags, type EnvConfig } from './config';

export interface AssetsStackProps extends cdk.StackProps {
  cfg: EnvConfig;
}

/**
 * Tenant-uploaded assets: logos today, document attachments and meeting
 * media later. Bucket layout enforces per-tenant key prefixes:
 *   tenants/{tenantId}/branding/logo.{ext}
 *   tenants/{tenantId}/documents/{docId}/{filename}
 *
 * Per-tenant separation is enforced at the API edge (presigned URLs only
 * cover the tenant's own prefix), not by separate buckets.
 *
 * Public access is blocked; logos are served via signed-GET URLs the API
 * mints on demand, never via a public-read ACL.
 */
export class AssetsStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly key: kms.Key;

  constructor(scope: Construct, id: string, props: AssetsStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    Object.entries(commonTags(cfg)).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    this.key = new kms.Key(this, 'AssetsKey', {
      alias: `alias/capiro/${cfg.envName}/assets`,
      description: `Capiro ${cfg.envName} tenant assets bucket CMK`,
      enableKeyRotation: true,
      removalPolicy: cfg.protectFromDestroy
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    this.bucket = new s3.Bucket(this, 'AssetsBucket', {
      bucketName: `capiro-${cfg.envName}-tenant-assets-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.key,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cfg.protectFromDestroy
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !cfg.protectFromDestroy,
      cors: [
        {
          // The browser PUTs files via presigned URLs from app.capiro.ai and
          // any tenant subdomain; SPA must read the response status.
          // Dedupe: in staging, appHost === rootDomain, so the two URLs
          // collapse and S3 CORS rejects array items that are not unique.
          allowedOrigins: Array.from(
            new Set([
              `https://${cfg.appHost}`,
              `https://${cfg.rootDomain}`,
              // Vanity tenant subdomain wildcard — S3 CORS supports the
              // `*.app.capiro.ai` form natively.
              `https://*.${cfg.appHost}`,
            ]),
          ),
          allowedMethods: [
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
          ],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'AbortIncompleteUploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
        {
          id: 'ExpireOldVersions',
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
    });

    new cdk.CfnOutput(this, 'AssetsBucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'AssetsKeyArn', { value: this.key.keyArn });
  }

  /** Add the IAM policy statements an API task role needs to mint presigned URLs. */
  grantApiAccess(grantee: iam.IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:GetObjectVersion'],
        resources: [`${this.bucket.bucketArn}/tenants/*`],
      }),
    );
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [this.bucket.bucketArn],
        conditions: { StringLike: { 's3:prefix': ['tenants/*'] } },
      }),
    );
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
        resources: [this.key.keyArn],
      }),
    );
  }
}
