import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { AppConfig } from '../../config/config.schema.js';

export interface TokenCiphertext {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export interface TokenEnvelope extends TokenCiphertext {
  keyVersion: string;
}

@Injectable()
export class TokenCryptoService {
  private readonly key?: Buffer;
  private readonly keyVersion: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const rawKey = config.get('OAUTH_TOKEN_ENCRYPTION_KEY', { infer: true });
    this.key = rawKey ? parseAesKey(rawKey) : undefined;
    this.keyVersion = config.get('OAUTH_TOKEN_ENCRYPTION_KEY_VERSION', { infer: true });
  }

  isConfigured(): boolean {
    return Boolean(this.key);
  }

  getKeyVersion(): string {
    return this.keyVersion;
  }

  encrypt(plainText: string): TokenEnvelope {
    if (!this.key) {
      throw new ServiceUnavailableException(
        'OAuth token encryption is not configured. Set OAUTH_TOKEN_ENCRYPTION_KEY.',
      );
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyVersion: this.keyVersion,
    };
  }

  decrypt(payload: TokenCiphertext): string {
    if (!this.key) {
      throw new ServiceUnavailableException(
        'OAuth token encryption is not configured. Set OAUTH_TOKEN_ENCRYPTION_KEY.',
      );
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(payload.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

function parseAesKey(value: string): Buffer {
  const trimmed = value.trim();
  const decoded =
    /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (decoded.length !== 32) {
    throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return decoded;
}
