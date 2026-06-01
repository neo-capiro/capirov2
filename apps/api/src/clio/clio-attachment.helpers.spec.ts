import { describe, expect, test } from '@jest/globals';
import {
  MAX_ATTACHMENT_BYTES,
  detectAttachmentKind,
  formatAttachmentContext,
  isExtractableKind,
  validateAttachment,
} from './clio-attachment.helpers.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('detectAttachmentKind', () => {
  test('by content-type', () => {
    expect(detectAttachmentKind('application/pdf')).toBe('pdf');
    expect(detectAttachmentKind(DOCX)).toBe('docx');
    expect(detectAttachmentKind('image/png')).toBe('image');
    expect(detectAttachmentKind('text/plain')).toBe('text');
    expect(detectAttachmentKind('application/zip')).toBe('unsupported');
  });
  test('falls back to filename extension', () => {
    expect(detectAttachmentKind('', 'memo.pdf')).toBe('pdf');
    expect(detectAttachmentKind('', 'brief.docx')).toBe('docx');
    expect(detectAttachmentKind('', 'logo.jpg')).toBe('image');
    expect(detectAttachmentKind('', 'notes.md')).toBe('text');
    expect(detectAttachmentKind('', 'archive.bin')).toBe('unsupported');
  });
});

describe('isExtractableKind', () => {
  test('docx + text are extractable; pdf/image/unsupported are not (yet)', () => {
    expect(isExtractableKind('docx')).toBe(true);
    expect(isExtractableKind('text')).toBe(true);
    expect(isExtractableKind('pdf')).toBe(false);
    expect(isExtractableKind('image')).toBe(false);
  });
});

describe('validateAttachment', () => {
  test('accepts a valid docx', () => {
    expect(validateAttachment({ contentType: DOCX, byteSize: 1000, filename: 'a.docx' }).ok).toBe(
      true,
    );
  });
  test('rejects empty, oversized, and unsupported', () => {
    expect(validateAttachment({ contentType: 'text/plain', byteSize: 0 }).ok).toBe(false);
    expect(
      validateAttachment({ contentType: 'text/plain', byteSize: MAX_ATTACHMENT_BYTES + 1 }).ok,
    ).toBe(false);
    expect(validateAttachment({ contentType: 'application/zip', byteSize: 10 }).reason).toBe(
      'Unsupported file type',
    );
  });
});

describe('formatAttachmentContext', () => {
  test('labels and clamps', () => {
    expect(formatAttachmentContext('memo.txt', 'hello')).toContain('Attached document "memo.txt"');
    const long = formatAttachmentContext('big.txt', 'x'.repeat(9000), 100);
    expect(long).toContain('[truncated]');
    expect(long.length).toBeLessThan(200);
  });
});
