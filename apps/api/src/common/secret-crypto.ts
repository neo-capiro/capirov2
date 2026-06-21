/**
 * Pure AES-256-GCM secret envelope helpers (same scheme as
 * engagement_connection_tokens / TokenCryptoService, parameterized by key so
 * non-Nest callers and other key namespaces can reuse it). Used by the Meri
 * MCP server config (F6a) to keep bearer tokens encrypted at rest — secrets
 * are write-only through the API and never returned in plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SecretEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/** Parse a 32-byte AES key from hex or base64 (throws on anything else). */
export function parseAesKey(value: string): Buffer {
  const trimmed = value.trim();
  const decoded = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (decoded.length !== 32) {
    throw new Error('Encryption key must decode to exactly 32 bytes');
  }
  return decoded;
}

export function encryptSecret(key: Buffer, plainText: string): SecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSecret(key: Buffer, envelope: SecretEnvelope): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
