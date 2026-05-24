import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { TenantContext } from '@capiro/shared';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateClientInput {
  name: string;
  website?: string;
  description?: string;
  productDescription?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  intakeData?: Record<string, unknown>;
  profileType?: string;
  sectorTag?: string;
  submissionTracks?: string[];
  profileStatus?: string;
}

export type UpdateClientInput = Partial<CreateClientInput> & { status?: string };

export interface ListClientsFilter {
  profileStatus?: string;
  sectorTag?: string;
}

const ALLOWED_LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']);
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * The lobbying firm's book of business. Tenant-scoped via RLS - the database
 * itself enforces isolation, the service just wires `withTenant` so the GUC
 * is set on every query.
 */
@Injectable()
export class ClientsService {
  private readonly s3: S3Client;
  private readonly bucket?: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.bucket = config.get('ASSETS_BUCKET', { infer: true });
    this.s3 = new S3Client({ region: config.get('AWS_REGION_DEFAULT', { infer: true }) });
  }

  async list(ctx: TenantContext, filter: ListClientsFilter = {}) {
    const where: Record<string, unknown> = {};
    if (filter.profileStatus) where.profileStatus = filter.profileStatus;
    if (filter.sectorTag) where.sectorTag = filter.sectorTag;

    const clients = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.client.findMany({ where, orderBy: { createdAt: 'desc' } }),
    );
    return this.withLogoUrls(clients);
  }

  async get(ctx: TenantContext, id: string) {
    const client = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.client.findUnique({ where: { id } }),
    );
    if (!client) throw new NotFoundException('Client not found');
    return this.withLogoUrl(client);
  }

  async create(ctx: TenantContext, input: CreateClientInput) {
    const client = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.client.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          website: input.website ?? null,
          description: input.description ?? null,
          productDescription: input.productDescription ?? null,
          primaryContactName: input.primaryContactName ?? null,
          primaryContactEmail: input.primaryContactEmail ?? null,
          primaryContactPhone: input.primaryContactPhone ?? null,
          intakeData: (input.intakeData ?? {}) as object,
          profileType: input.profileType ?? null,
          sectorTag: input.sectorTag ?? null,
          submissionTracks: input.submissionTracks ?? [],
          profileStatus: input.profileStatus ?? 'ACTIVE',
          createdByUserId: ctx.userId,
        },
      }),
    );
    return this.withLogoUrl(client);
  }

  async update(ctx: TenantContext, id: string, input: UpdateClientInput) {
    const client = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.client.update({
        where: { id },
        data: {
          ...('name' in input ? { name: input.name } : {}),
          ...('website' in input ? { website: input.website ?? null } : {}),
          ...('description' in input ? { description: input.description ?? null } : {}),
          ...('productDescription' in input
            ? { productDescription: input.productDescription ?? null }
            : {}),
          ...('primaryContactName' in input
            ? { primaryContactName: input.primaryContactName ?? null }
            : {}),
          ...('primaryContactEmail' in input
            ? { primaryContactEmail: input.primaryContactEmail ?? null }
            : {}),
          ...('primaryContactPhone' in input
            ? { primaryContactPhone: input.primaryContactPhone ?? null }
            : {}),
          ...('intakeData' in input ? { intakeData: (input.intakeData ?? {}) as object } : {}),
          ...('status' in input ? { status: input.status! } : {}),
          ...('profileType' in input ? { profileType: input.profileType ?? null } : {}),
          ...('sectorTag' in input ? { sectorTag: input.sectorTag ?? null } : {}),
          ...('submissionTracks' in input ? { submissionTracks: input.submissionTracks ?? [] } : {}),
          ...('profileStatus' in input ? { profileStatus: input.profileStatus! } : {}),
        },
      }),
    );
    return this.withLogoUrl(client);
  }

  archive(ctx: TenantContext, id: string) {
    return this.update(ctx, id, { status: 'archived' });
  }

  async createLogoUploadUrl(
    ctx: TenantContext,
    clientId: string,
    contentType: string,
    contentLength: number,
  ) {
    if (!this.bucket) throw new BadRequestException('Asset uploads are not configured');
    if (!ALLOWED_LOGO_MIME.has(contentType)) {
      throw new BadRequestException(`Unsupported logo content type: ${contentType}`);
    }
    if (contentLength > MAX_LOGO_BYTES) {
      throw new BadRequestException(`Logo must be <= ${MAX_LOGO_BYTES} bytes`);
    }

    await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const client = await tx.client.findUnique({ where: { id: clientId }, select: { id: true } });
      if (!client) throw new NotFoundException('Client not found');
    });

    const ext = contentType === 'image/svg+xml' ? 'svg' : (contentType.split('/')[1] ?? 'png');
    const s3Key = `tenants/${ctx.tenantId}/clients/${clientId}/logo.${ext}`;
    const presigned = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: s3Key,
      Conditions: [
        ['content-length-range', 1, MAX_LOGO_BYTES],
        ['eq', '$Content-Type', contentType],
        ['starts-with', '$key', `tenants/${ctx.tenantId}/clients/${clientId}/`],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: 300,
    });
    return { ...presigned, s3Key };
  }

  async confirmLogoUpload(
    ctx: TenantContext,
    clientId: string,
    s3Key: string,
    contentType: string,
  ) {
    if (!this.bucket) throw new BadRequestException('Assets bucket not configured');
    if (!s3Key.startsWith(`tenants/${ctx.tenantId}/clients/${clientId}/`)) {
      throw new BadRequestException('Logo key is outside the client tenant prefix');
    }
    if (!ALLOWED_LOGO_MIME.has(contentType)) {
      throw new BadRequestException(`Unsupported logo content type: ${contentType}`);
    }

    const head = await this.s3
      .send(new HeadObjectCommand({ Bucket: this.bucket, Key: s3Key }))
      .catch(() => null);
    if (!head) throw new BadRequestException('Uploaded logo not found in S3');

    const updated = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.client.update({
        where: { id: clientId },
        data: {
          logoS3Key: s3Key,
          logoContentType: contentType,
          logoUploadedAt: new Date(),
        },
      }),
    );
    return this.withLogoUrl(updated);
  }

  private async withLogoUrls<T extends { logoS3Key: string | null }>(
    clients: T[],
  ): Promise<Array<T & { logoUrl: string | null }>> {
    return Promise.all(clients.map((client) => this.withLogoUrl(client)));
  }

  private async withLogoUrl<T extends { logoS3Key: string | null }>(
    client: T,
  ): Promise<T & { logoUrl: string | null }> {
    return {
      ...client,
      logoUrl: client.logoS3Key ? await this.signedGetUrl(client.logoS3Key) : null,
    };
  }

  private async signedGetUrl(s3Key: string, ttlSeconds = 300): Promise<string | null> {
    if (!this.bucket) return null;
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }), {
      expiresIn: ttlSeconds,
    });
  }
}
