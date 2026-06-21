import { describe, expect, test } from '@jest/globals';
import { MockDocStorageConnector, type StoredFile } from './doc-storage.connector.js';

const file = (id: string): { meta: StoredFile; text: string } => ({
  meta: { id, name: `${id}.txt`, mimeType: 'text/plain', size: 10 },
  text: `contents of ${id}`,
});

describe('MockDocStorageConnector', () => {
  test('lists seeded files and reads their text', async () => {
    const c = new MockDocStorageConnector([file('a'), file('b')]);
    expect(c.status()).toBe('connected');
    const files = await c.listFiles();
    expect(files.map((f) => f.id).sort()).toEqual(['a', 'b']);
    expect(await c.getFileText('a')).toBe('contents of a');
  });

  test('throws on a missing file', async () => {
    const c = new MockDocStorageConnector();
    await expect(c.getFileText('nope')).rejects.toThrow(/not found/i);
  });
});
