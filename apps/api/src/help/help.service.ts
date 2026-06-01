import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config/config.schema.js';
import {
  helpManifestSchema,
  HELP_MANIFEST_KEY,
  HELP_KEY_PREFIX,
  type HelpCategory,
  type HelpItem,
  type HelpManifest,
} from './help-content.js';

/** A help item with the asset's S3 key resolved to a short-lived presigned URL. */
export interface ResolvedHelpItem extends Omit<HelpItem, 's3Key' | 'thumbnailS3Key'> {
  url: string | null;
  thumbnailUrl: string | null;
}

export interface ResolvedHelpCategory extends Omit<HelpCategory, 'items'> {
  items: ResolvedHelpItem[];
}

@Injectable()
export class HelpService {
  private readonly logger = new Logger(HelpService.name);
  private readonly s3: S3Client;
  private readonly bucket: string | undefined;
  // Long enough to watch a full video without the URL expiring mid-playback.
  private readonly urlTtlSeconds = 3600;

  constructor(config: ConfigService<AppConfig, true>) {
    this.bucket = config.get('ASSETS_BUCKET', { infer: true });
    this.s3 = new S3Client({ region: config.get('AWS_REGION_DEFAULT', { infer: true }) });
  }

  /**
   * Return the help library with every asset resolved to a presigned GET URL.
   *
   * Content is sourced live from `<ASSETS_BUCKET>/help/manifest.json`, so videos
   * and guides can be added or changed without a redeploy. The manifest is the
   * allowlist; combined with the `help/` prefix guard in signedGetUrl, this can
   * never presign an arbitrary object (e.g. another tenant's logo).
   */
  async listContent(): Promise<ResolvedHelpCategory[]> {
    const manifest = await this.loadManifest();
    return Promise.all(
      manifest.categories.map(async (category) => ({
        id: category.id,
        title: category.title,
        description: category.description,
        items: await Promise.all(
          category.items.map(async (item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            type: item.type,
            durationLabel: item.durationLabel,
            url: await this.signedGetUrl(item.s3Key),
            thumbnailUrl: item.thumbnailS3Key ? await this.signedGetUrl(item.thumbnailS3Key) : null,
          })),
        ),
      })),
    );
  }

  /**
   * Load + validate the JSON manifest from S3. Any problem (object not uploaded
   * yet, malformed JSON, failed schema validation, S3/permission error) degrades
   * gracefully to an empty library and is logged — a bad manifest edit shows an
   * empty Help page rather than 500-ing the endpoint.
   */
  private async loadManifest(): Promise<HelpManifest> {
    if (!this.bucket) {
      this.logger.warn('ASSETS_BUCKET is not configured; help content unavailable');
      return { categories: [] };
    }
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: HELP_MANIFEST_KEY }),
      );
      const body = await res.Body?.transformToString();
      if (!body) return { categories: [] };
      return helpManifestSchema.parse(JSON.parse(body));
    } catch (err) {
      this.logger.warn(
        `Help manifest unavailable at s3://${this.bucket}/${HELP_MANIFEST_KEY}: ${(err as Error).message}`,
      );
      return { categories: [] };
    }
  }

  private async signedGetUrl(key: string, ttlSeconds = this.urlTtlSeconds): Promise<string | null> {
    if (!this.bucket) return null;
    // Defense-in-depth: never sign anything outside the help/ prefix, even if a
    // manifest entry (or a tampered manifest) points elsewhere in the bucket.
    if (!key.startsWith(HELP_KEY_PREFIX)) {
      this.logger.warn(`Refusing to presign help key outside '${HELP_KEY_PREFIX}': ${key}`);
      return null;
    }
    try {
      return await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
        expiresIn: ttlSeconds,
      });
    } catch (err) {
      this.logger.warn(`Failed to presign help asset ${key}: ${(err as Error).message}`);
      return null;
    }
  }
}
