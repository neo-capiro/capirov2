import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config/config.schema.js';
import {
  helpManifestSchema,
  HELP_MANIFEST_KEY,
  HELP_KEY_PREFIX,
  HELP_VIDEO_PREFIX,
  HELP_DISCOVERED_CATEGORY_ID,
  HELP_DISCOVERED_CATEGORY_TITLE,
  isHelpVideoKey,
  titleFromVideoKey,
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
   * Content is sourced live from `<ASSETS_BUCKET>/help/manifest.json` for curated
   * titles/descriptions/ordering, PLUS auto-discovery of any video uploaded under
   * `help/videos/` that the manifest doesn't already reference (appended as a
   * "More videos" category). Both paths run through signedGetUrl's `help/` prefix
   * guard, so this can never presign an arbitrary object (e.g. another tenant's
   * logo). Videos therefore appear from a plain S3 upload, with or without a
   * manifest edit.
   */
  async listContent(): Promise<ResolvedHelpCategory[]> {
    const manifest = await this.loadManifest();

    const curated = await Promise.all(
      manifest.categories.map(async (category) => ({
        id: category.id,
        title: category.title,
        description: category.description,
        items: await Promise.all(category.items.map((item) => this.resolveItem(item))),
      })),
    );

    // Surface uploaded-but-unlisted videos so a manifest edit isn't required.
    const referencedKeys = new Set(
      manifest.categories.flatMap((c) => c.items.map((i) => i.s3Key)),
    );
    const discovered = await this.discoverVideoItems(referencedKeys);
    if (discovered.length > 0) {
      curated.push({
        id: HELP_DISCOVERED_CATEGORY_ID,
        title: HELP_DISCOVERED_CATEGORY_TITLE,
        description: undefined,
        items: discovered,
      });
    }
    return curated;
  }

  /** Resolve a manifest item's S3 key(s) to short-lived presigned URLs. */
  private async resolveItem(item: HelpItem): Promise<ResolvedHelpItem> {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      type: item.type,
      durationLabel: item.durationLabel,
      url: await this.signedGetUrl(item.s3Key),
      thumbnailUrl: item.thumbnailS3Key ? await this.signedGetUrl(item.thumbnailS3Key) : null,
    };
  }

  /**
   * List video objects under `help/videos/` and return resolved items for any
   * not already referenced by the manifest. Titles are derived from filenames;
   * thumbnails are omitted (the page falls back to a play-icon cover). Listing
   * is best-effort: any S3/permission error degrades to no extra videos.
   */
  private async discoverVideoItems(referencedKeys: Set<string>): Promise<ResolvedHelpItem[]> {
    if (!this.bucket) return [];
    const keys: string[] = [];
    try {
      let token: string | undefined;
      do {
        const res = await this.s3.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: HELP_VIDEO_PREFIX,
            ContinuationToken: token,
          }),
        );
        for (const obj of res.Contents ?? []) {
          if (obj.Key && isHelpVideoKey(obj.Key) && !referencedKeys.has(obj.Key)) {
            keys.push(obj.Key);
          }
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
    } catch (err) {
      this.logger.warn(
        `Help video auto-discovery failed at s3://${this.bucket}/${HELP_VIDEO_PREFIX}: ${(err as Error).message}`,
      );
      return [];
    }

    // Stable, predictable order regardless of S3 listing order.
    keys.sort((a, b) => a.localeCompare(b));
    return Promise.all(
      keys.map(async (key) => ({
        id: key,
        title: titleFromVideoKey(key),
        description: '',
        type: 'video' as const,
        durationLabel: undefined,
        url: await this.signedGetUrl(key),
        thumbnailUrl: null,
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
