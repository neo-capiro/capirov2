/**
 * Help center content — schema + types only.
 *
 * The live content is NOT compiled into the app. It lives as a JSON document in
 * S3 at `<ASSETS_BUCKET>/help/manifest.json`, so videos and guides can be added
 * or changed WITHOUT a rebuild/redeploy:
 *
 *   1. Upload the asset to S3 under the `help/` prefix, e.g.
 *        help/videos/product-tour.mp4
 *        help/guides/quick-start.pdf
 *        help/thumbnails/product-tour.png   (optional poster image)
 *   2. Edit `help/manifest.json` in the same bucket to reference the new key(s).
 *
 * HelpService validates the document against the schema below and presigns each
 * listed key. The manifest is the allowlist, and (combined with the `help/`
 * prefix guard in HelpService) the endpoint can never presign an arbitrary
 * object such as another tenant's logo.
 *
 * Manifest shape:
 * {
 *   "categories": [
 *     {
 *       "id": "getting-started",
 *       "title": "Getting started",
 *       "description": "optional category blurb",
 *       "items": [
 *         {
 *           "id": "product-tour",
 *           "title": "Product tour",
 *           "description": "Short blurb shown on the card.",
 *           "type": "video",                                   // "video" | "guide"
 *           "s3Key": "help/videos/product-tour.mp4",
 *           "thumbnailS3Key": "help/thumbnails/product-tour.png", // optional
 *           "durationLabel": "5 min"                           // optional
 *         }
 *       ]
 *     }
 *   ]
 * }
 */
import { z } from 'zod';

export const helpItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  type: z.enum(['video', 'guide']),
  /** Object key under ASSETS_BUCKET, e.g. 'help/videos/product-tour.mp4'. */
  s3Key: z.string().min(1),
  /** Optional poster/cover image key under ASSETS_BUCKET. */
  thumbnailS3Key: z.string().optional(),
  /** Optional length label shown on the card, e.g. '5 min', '6 pages'. */
  durationLabel: z.string().optional(),
});

export const helpCategorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  items: z.array(helpItemSchema).default([]),
});

export const helpManifestSchema = z.object({
  categories: z.array(helpCategorySchema).default([]),
});

export type HelpItemType = 'video' | 'guide';
export type HelpItem = z.infer<typeof helpItemSchema>;
export type HelpCategory = z.infer<typeof helpCategorySchema>;
export type HelpManifest = z.infer<typeof helpManifestSchema>;

/** S3 object key (under ASSETS_BUCKET) that holds the live help manifest. */
export const HELP_MANIFEST_KEY = 'help/manifest.json';

/** Defense-in-depth: HelpService only ever presigns keys under this prefix. */
export const HELP_KEY_PREFIX = 'help/';
