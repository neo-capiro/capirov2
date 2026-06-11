import { describe, expect, test } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, parseAesKey } from './secret-crypto.js';

describe('secret-crypto (AES-256-GCM envelope)', () => {
  const key = randomBytes(32);

  test('round-trips a secret', () => {
    const envelope = encryptSecret(key, 'bearer-token-123');
    expect(envelope.ciphertext).not.toContain('bearer-token-123');
    expect(decryptSecret(key, envelope)).toBe('bearer-token-123');
  });

  test('unique IV per encryption (no ciphertext reuse)', () => {
    const a = encryptSecret(key, 'same');
    const b = encryptSecret(key, 'same');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  test('tampered ciphertext fails authentication', () => {
    const envelope = encryptSecret(key, 'secret');
    const tampered = {
      ...envelope,
      ciphertext: Buffer.from('tampered-data').toString('base64'),
    };
    expect(() => decryptSecret(key, tampered)).toThrow();
  });

  test('parseAesKey accepts 32-byte hex and base64, rejects others', () => {
    const hex = randomBytes(32).toString('hex');
    expect(parseAesKey(hex)).toHaveLength(32);
    const b64 = randomBytes(32).toString('base64');
    expect(parseAesKey(b64)).toHaveLength(32);
    expect(() => parseAesKey('too-short')).toThrow();
  });
});
