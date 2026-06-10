import { isAllowedAttachmentContentType } from './engagement.service.js';

describe('isAllowedAttachmentContentType — engagement attachment allowlist', () => {
  test('accepts the advertised document types', () => {
    expect(isAllowedAttachmentContentType('application/pdf')).toBe(true);
    expect(isAllowedAttachmentContentType('application/msword')).toBe(true);
    expect(
      isAllowedAttachmentContentType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(true);
    expect(isAllowedAttachmentContentType('text/plain')).toBe(true);
  });

  test('accepts any image/*, plus audio/* and video/* for the debrief transcript flow', () => {
    expect(isAllowedAttachmentContentType('image/png')).toBe(true);
    expect(isAllowedAttachmentContentType('image/heic')).toBe(true);
    expect(isAllowedAttachmentContentType('audio/webm')).toBe(true);
    expect(isAllowedAttachmentContentType('video/mp4')).toBe(true);
  });

  test('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(isAllowedAttachmentContentType('Application/PDF')).toBe(true);
    expect(isAllowedAttachmentContentType(' image/png ')).toBe(true);
  });

  test('rejects application/octet-stream (the FE fallback for unknown drag-dropped types)', () => {
    expect(isAllowedAttachmentContentType('application/octet-stream')).toBe(false);
  });

  test('rejects types no upload flow advertises', () => {
    expect(isAllowedAttachmentContentType('application/zip')).toBe(false);
    expect(isAllowedAttachmentContentType('application/x-msdownload')).toBe(false);
    expect(isAllowedAttachmentContentType('text/html')).toBe(false);
    expect(isAllowedAttachmentContentType('')).toBe(false);
  });

  test('rejects image/svg+xml despite the image/ prefix (scriptable, replays inline from S3)', () => {
    expect(isAllowedAttachmentContentType('image/svg+xml')).toBe(false);
    expect(isAllowedAttachmentContentType(' Image/SVG+XML ')).toBe(false);
  });
});
