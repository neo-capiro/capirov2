import { describe, expect, test } from '@jest/globals';
import { helpManifestSchema, isHelpVideoKey, titleFromVideoKey } from './help-content.js';

describe('helpManifestSchema', () => {
  test('parses a well-formed manifest and applies defaults', () => {
    const parsed = helpManifestSchema.parse({
      categories: [
        {
          id: 'getting-started',
          title: 'Getting started',
          items: [
            { id: 'tour', title: 'Product tour', type: 'video', s3Key: 'help/videos/tour.mp4' },
          ],
        },
      ],
    });
    expect(parsed.categories).toHaveLength(1);
    const cat = parsed.categories[0]!;
    expect(cat.description).toBeUndefined();
    const item = cat.items[0]!;
    expect(item.description).toBe(''); // defaulted
    expect(item.thumbnailS3Key).toBeUndefined();
  });

  test('defaults categories and items to empty arrays', () => {
    expect(helpManifestSchema.parse({}).categories).toEqual([]);
    const cat = helpManifestSchema.parse({ categories: [{ id: 'c', title: 'C' }] }).categories[0]!;
    expect(cat.items).toEqual([]);
  });

  test('rejects an item with an unknown type', () => {
    expect(() =>
      helpManifestSchema.parse({
        categories: [
          {
            id: 'c',
            title: 'C',
            items: [{ id: 'i', title: 'I', type: 'pdf', s3Key: 'help/x.pdf' }],
          },
        ],
      }),
    ).toThrow();
  });

  test('rejects an item missing a required field (s3Key)', () => {
    expect(() =>
      helpManifestSchema.parse({
        categories: [{ id: 'c', title: 'C', items: [{ id: 'i', title: 'I', type: 'guide' }] }],
      }),
    ).toThrow();
  });
});

describe('isHelpVideoKey', () => {
  test('accepts playable video extensions directly under help/videos/', () => {
    expect(isHelpVideoKey('help/videos/tour.mp4')).toBe(true);
    expect(isHelpVideoKey('help/videos/Sub Folder/demo.WEBM')).toBe(true); // case-insensitive
    expect(isHelpVideoKey('help/videos/clip.mov')).toBe(true);
  });

  test('rejects non-video keys, other prefixes, and the prefix itself', () => {
    expect(isHelpVideoKey('help/videos/notes.pdf')).toBe(false);
    expect(isHelpVideoKey('help/guides/quick-start.pdf')).toBe(false);
    expect(isHelpVideoKey('help/manifest.json')).toBe(false);
    expect(isHelpVideoKey('tenants/abc/logo.png')).toBe(false);
    expect(isHelpVideoKey('help/videos/')).toBe(false); // the prefix placeholder
  });
});

describe('titleFromVideoKey', () => {
  test('derives a sentence-cased title from the filename', () => {
    expect(titleFromVideoKey('help/videos/product-tour.mp4')).toBe('Product tour');
    expect(titleFromVideoKey('help/videos/getting-started_part-2.webm')).toBe(
      'Getting started part 2',
    );
    expect(titleFromVideoKey('help/videos/Onboarding.mov')).toBe('Onboarding');
  });
});
