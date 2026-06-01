import { describe, expect, test } from '@jest/globals';
import { helpManifestSchema } from './help-content.js';

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
