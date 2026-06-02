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
 *   2. (Optional) Edit `help/manifest.json` in the same bucket to give the asset
 *      a curated title/description/category and ordering.
 *
 * AUTO-DISCOVERY: a curated manifest is no longer required just to make a video
 * appear. Any video object dropped under `help/videos/` (see HELP_VIDEO_PREFIX /
 * HELP_VIDEO_EXTENSIONS) that the manifest does not already reference is listed
 * automatically in a fallback "More videos" category, with a title derived from
 * its filename. Curate it later by adding a manifest entry with the same s3Key;
 * once referenced there, it stops appearing in the auto-discovered group. Guides
 * (PDFs) are still manifest-only, since a PDF has no safe auto-title/poster.
 *
 * HelpService validates the document against the schema below and presigns each
 * listed key. Both the manifest entries and any auto-discovered keys are confined
 * to the `help/` prefix by the guard in HelpService, so the endpoint can never
 * presign an arbitrary object such as another tenant's logo.
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

/** Prefix under which uploaded help videos are auto-discovered. */
export const HELP_VIDEO_PREFIX = 'help/videos/';

/** Lower-cased file extensions treated as browser-playable help videos. */
export const HELP_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v', '.ogg', '.ogv'];

/** Category id/title used for videos found in S3 but not referenced by the manifest. */
export const HELP_DISCOVERED_CATEGORY_ID = 'more-videos';
export const HELP_DISCOVERED_CATEGORY_TITLE = 'More videos';

/** True when the key is a video object directly under `help/videos/` (not the prefix itself). */
export function isHelpVideoKey(key: string): boolean {
  if (!key.startsWith(HELP_VIDEO_PREFIX) || key.endsWith('/')) return false;
  const lower = key.toLowerCase();
  return HELP_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Derive a human-friendly title from a video object key, e.g.
 *   `help/videos/getting-started_part-2.mp4` -> `Getting started part 2`.
 * Strips the prefix + extension, splits on -/_/whitespace, and sentence-cases.
 */
export function titleFromVideoKey(key: string): string {
  const file = key.slice(key.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  const words = file
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return 'Untitled video';
  return words.charAt(0).toUpperCase() + words.slice(1);
}
