import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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

@Injectable()
export class RendererService {
  private readonly logger = new Logger(RendererService.name);
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
  ) {
    if (!this.bucket) throw new ServiceUnavailableException('ASSETS_BUCKET is not configured');

    const artifactId = randomUUID();
    const markdown = this.renderMarkdown(kind, input);
    const title = input.title.trim();
    const s3Key = `tenants/${ctx.tenantId}/artifacts/${artifactId}.md`;
    const citations = kind === 'policy_memo' ? (input as PolicyMemoInput).citations : [];

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: markdown,
        ContentType: MARKDOWN_CONTENT_TYPE,
      }),
    );

    try {
      return await this.prisma.withTenant(ctx.tenantId, (tx) =>
        tx.clioArtifact.create({
          data: {
            id: artifactId,
            tenantId: ctx.tenantId,
            createdByUserId: ctx.userId,
            kind: kind as ClioArtifactKind,
            title,
            content: markdown,
            s3Key,
            s3ContentType: MARKDOWN_CONTENT_TYPE,
            metadata: { citations } satisfies Prisma.InputJsonObject,
          },
        }),
      );
    } catch (error) {
      await this.cleanupS3Object(s3Key, error);
      throw error;
    }
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

  private async cleanupS3Object(s3Key: string, originalError: unknown): Promise<void> {
    if (!this.bucket) return;
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: s3Key }));
    } catch (cleanupError) {
      this.logger.error(
        `Failed to clean up S3 object ${s3Key} after artifact persistence failure`,
        cleanupError instanceof Error ? cleanupError.stack : String(cleanupError),
      );
      if (originalError instanceof Error) {
        originalError.message = `${originalError.message} (also failed to clean up ${s3Key})`;
      }
    }
  }
}
