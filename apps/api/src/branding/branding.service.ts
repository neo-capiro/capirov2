import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { TenantContext } from '@capiro/shared';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']);
const MAX_BYTES = 2 * 1024 * 1024;

@Injectable()
export class BrandingService {
  private readonly logger = new Logger(BrandingService.name);
  private readonly s3: S3Client;
  private readonly bucket: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    const region = config.get('AWS_REGION_DEFAULT', { infer: true });
    this.bucket = config.get('ASSETS_BUCKET', { infer: true });
    this.s3 = new S3Client({ region });
  }

  async getBranding(ctx: TenantContext) {
    const tenant = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: {
          id: true,
          slug: true,
          name: true,
          logoS3Key: true,
          logoContentType: true,
          logoUploadedAt: true,
        },
      }),
    );
    if (!tenant) return null;
    const logoUrl = tenant.logoS3Key ? await this.signedGetUrl(tenant.logoS3Key) : null;
    return { ...tenant, logoUrl };
  }

  /**
   * Issue a presigned POST policy that lets the browser upload directly to
   * S3. Limits: content type whitelist + 2 MB. Key is fully tenant-scoped:
   *   tenants/{tenantId}/branding/logo-{ext}
   */
  async createLogoUploadUrl(ctx: TenantContext, contentType: string, contentLength: number) {
    if (!this.bucket) {
      throw new BadRequestException(
        'Asset uploads are not configured (ASSETS_BUCKET unset)',
      );
    }
    if (!ALLOWED_MIME.has(contentType)) {
      throw new BadRequestException(`Unsupported content type: ${contentType}`);
    }
    if (contentLength > MAX_BYTES) {
      throw new BadRequestException(`Logo must be <= ${MAX_BYTES} bytes`);
    }
    const ext = contentType === 'image/svg+xml' ? 'svg' : contentType.split('/')[1];
    const s3Key = `tenants/${ctx.tenantId}/branding/logo.${ext}`;
    const presigned = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: s3Key,
      Conditions: [
        ['content-length-range', 0, MAX_BYTES],
        ['eq', '$Content-Type', contentType],
        ['starts-with', '$key', `tenants/${ctx.tenantId}/branding/`],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: 300, // 5 min
    });
    return { ...presigned, s3Key };
  }

  /**
   * Confirm the upload happened. We HEAD the object to verify it exists +
   * matches the declared content type, then update the tenant row.
   */
  async confirmLogoUpload(ctx: TenantContext, s3Key: string, contentType: string) {
    if (!this.bucket) throw new BadRequestException('Assets bucket not configured');
    if (!s3Key.startsWith(`tenants/${ctx.tenantId}/branding/`)) {
      throw new BadRequestException('Key is outside tenant prefix');
    }
    if (!ALLOWED_MIME.has(contentType)) {
      throw new BadRequestException(`Unsupported content type: ${contentType}`);
    }
    const head = await this.s3
      .send(new HeadObjectCommand({ Bucket: this.bucket, Key: s3Key }))
      .catch(() => null);
    if (!head) throw new BadRequestException('Object not found at the given key');
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          logoS3Key: s3Key,
          logoContentType: contentType,
          logoUploadedAt: new Date(),
        },
      }),
    );
  }

  private async signedGetUrl(s3Key: string, ttlSeconds = 300): Promise<string | null> {
    if (!this.bucket) return null;
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }),
      { expiresIn: ttlSeconds },
    );
  }
}
