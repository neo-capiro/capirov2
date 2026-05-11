import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClioArtifactKind, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { TenantContext } from '@capiro/shared';
import type { AppConfig } from '../../config/config.schema.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { renderMeetingBrief, type MeetingBriefInput } from './meeting-brief.template.js';
import { renderPolicyMemo, type PolicyMemoInput } from './policy-memo.template.js';

const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

export type ArtifactRenderKind = 'policy_memo' | 'meeting_brief';

export type ArtifactRenderInput = {
  policy_memo: PolicyMemoInput;
  meeting_brief: MeetingBriefInput;
};

export interface ArtifactRenderContext extends Pick<TenantContext, 'tenantId' | 'userId'> {}

export interface ArtifactRenderOptions {
  replacing?: string;
}

@Injectable()
export class RendererService {
  private readonly bucket?: string;
  private readonly s3: S3Client;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.bucket = config.get('ASSETS_BUCKET', { infer: true });
    this.s3 = new S3Client({ region: config.get('AWS_REGION_DEFAULT', { infer: true }) });
  }

  async render<K extends ArtifactRenderKind>(
    kind: K,
    input: ArtifactRenderInput[K],
    ctx: ArtifactRenderContext,
    options: ArtifactRenderOptions = {},
  ) {
    if (!this.bucket) throw new ServiceUnavailableException('ASSETS_BUCKET is not configured');

    const markdown = this.renderMarkdown(kind, input);
    const title = input.title.trim();
    const citations = kind === 'policy_memo' ? (input as PolicyMemoInput).citations : [];
    const artifactId = randomUUID();

    const pending = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const version = options.replacing ? await nextArtifactVersion(tx, options.replacing) : 1;
      const plannedS3Key = `tenants/${ctx.tenantId}/artifacts/${artifactId}/v${version}.md`;
      const artifact = await tx.clioArtifact.create({
        data: {
          id: artifactId,
          tenantId: ctx.tenantId,
          createdByUserId: ctx.userId,
          replacingArtifactId: options.replacing ?? null,
          kind: kind as ClioArtifactKind,
          title,
          status: 'pending',
          version,
          content: markdown,
          s3Key: null,
          s3ContentType: null,
          metadata: {
            citations,
            version,
            plannedS3Key,
            ...(options.replacing ? { replacing: options.replacing } : {}),
          } satisfies Prisma.InputJsonObject,
        },
      });
      return artifact;
    });

    const s3Key = `tenants/${ctx.tenantId}/artifacts/${pending.id}/v${pending.version}.md`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: markdown,
        ContentType: MARKDOWN_CONTENT_TYPE,
      }),
    );

    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioArtifact.update({
        where: { id: pending.id },
        data: {
          status: 'ready',
          s3Key,
          s3ContentType: MARKDOWN_CONTENT_TYPE,
          metadata: {
            citations,
            version: pending.version,
            s3Key,
            ...(options.replacing ? { replacing: options.replacing } : {}),
          } satisfies Prisma.InputJsonObject,
        },
      }),
    );
  }

  private renderMarkdown<K extends ArtifactRenderKind>(kind: K, input: ArtifactRenderInput[K]): string {
    switch (kind) {
      case 'policy_memo':
        return renderPolicyMemo(input as PolicyMemoInput);
      case 'meeting_brief':
        return renderMeetingBrief(input as MeetingBriefInput);
      default:
        throw new BadRequestException(`Unsupported artifact kind: ${String(kind)}`);
    }
  }
}

async function nextArtifactVersion(tx: Prisma.TransactionClient, replacing: string): Promise<number> {
  const previous = await tx.clioArtifact.findFirst({
    where: { id: replacing },
    select: { version: true },
  });
  if (!previous) throw new BadRequestException('Artifact to replace was not found');

  const latestReplacement = await tx.clioArtifact.findFirst({
    where: { replacingArtifactId: replacing },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  return Math.max(previous.version, latestReplacement?.version ?? 0) + 1;
}
