import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { AppConfig } from '../config/config.schema.js';

interface EncryptedPayload {
  bodyCiphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}

@Injectable()
export class MeetingNotesCryptoService {
  private readonly key?: Buffer;
  private readonly keyVersion: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const rawKey = config.get('NOTES_ENCRYPTION_KEY', { infer: true });
    this.key = rawKey ? parseAesKey(rawKey) : undefined;
    this.keyVersion = config.get('NOTES_ENCRYPTION_KEY_VERSION', { infer: true });
  }

  capabilities() {
    return { encryptedNotesConfigured: Boolean(this.key), keyVersion: this.keyVersion };
  }

  encrypt(plainText: string): EncryptedPayload {
    if (!this.key) {
      throw new ServiceUnavailableException(
        'Encrypted meeting notes are not configured. Set NOTES_ENCRYPTION_KEY.',
      );
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      bodyCiphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyVersion: this.keyVersion,
    };
  }

  decrypt(payload: Pick<EncryptedPayload, 'bodyCiphertext' | 'iv' | 'authTag'>): string {
    if (!this.key) {
      throw new ServiceUnavailableException(
        'Encrypted meeting notes are not configured. Set NOTES_ENCRYPTION_KEY.',
      );
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(payload.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.bodyCiphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

function parseAesKey(value: string): Buffer {
  const trimmed = value.trim();
  const decoded =
    /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (decoded.length !== 32) {
    throw new Error('NOTES_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return decoded;
}
