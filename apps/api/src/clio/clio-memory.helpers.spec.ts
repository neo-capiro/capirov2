import {
  buildSavedMemoryRecord,
  memoryKeySlug,
  userScopedMemoryKey,
} from './clio-memory.helpers.js';

describe('memoryKeySlug', () => {
  it('slugifies and bounds a topic', () => {
    expect(memoryKeySlug('Preferred Nickname!')).toBe('preferred-nickname');
    expect(memoryKeySlug('  spaced  out  ')).toBe('spaced-out');
  });
  it('falls back to "note" for empty/punctuation-only input', () => {
    expect(memoryKeySlug('')).toBe('note');
    expect(memoryKeySlug('!!!')).toBe('note');
  });
});

describe('userScopedMemoryKey', () => {
  it('namespaces a key by user id (matches ClioService format)', () => {
    expect(userScopedMemoryKey('u-123', 'nickname')).toBe('user:u-123:nickname');
  });
});

describe('buildSavedMemoryRecord', () => {
  it('defaults to user_private scope and namespaces the key by user', () => {
    const rec = buildSavedMemoryRecord({
      content: 'The user prefers to be called Ninja',
      key: 'nickname',
      userId: 'u-1',
    });
    expect(rec).toEqual({
      scope: 'user_private',
      ownerUserId: 'u-1',
      key: 'user:u-1:nickname',
      value: 'The user prefers to be called Ninja',
      source: 'user_requested',
    });
  });

  it('stores firm-wide (no owner, un-namespaced key) when scope is "firm"', () => {
    const rec = buildSavedMemoryRecord({
      content: 'The firm bills clients monthly',
      key: 'billing-cadence',
      scope: 'firm',
      userId: 'u-1',
    });
    expect(rec).toMatchObject({ scope: 'firm', ownerUserId: null, key: 'billing-cadence' });
  });

  it('derives a key from content when none is provided', () => {
    const rec = buildSavedMemoryRecord({
      content: 'Always cc the chief of staff on every outreach email',
      userId: 'u-9',
    });
    // key derives from the first 8 words of content, slugified + user-namespaced.
    expect(rec!.key).toBe('user:u-9:always-cc-the-chief-of-staff-on-every');
  });

  it('returns null for empty/whitespace content', () => {
    expect(buildSavedMemoryRecord({ content: '   ', userId: 'u-1' })).toBeNull();
    expect(buildSavedMemoryRecord({ content: '', userId: 'u-1' })).toBeNull();
  });

  it('caps very long values', () => {
    const rec = buildSavedMemoryRecord({ content: 'x'.repeat(9000), userId: 'u-1' });
    expect(rec!.value.length).toBe(4000);
  });

  it('treats unknown scope strings as personal', () => {
    const rec = buildSavedMemoryRecord({ content: 'note', scope: 'galaxy', userId: 'u-2' });
    expect(rec!.scope).toBe('user_private');
  });
});
