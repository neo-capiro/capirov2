/**
 * Pure helpers for Clio multimodal/document input (P2-7).
 *
 * Kind detection, validation (type allowlist + size cap), and context formatting
 * for uploaded attachments. The actual extraction (mammoth for docx, utf-8 for
 * text) is I/O and lives in the service; PDF/image text extraction needs a parser
 * not currently in deps and is a documented follow-up. Pure so it unit-tests
 * under `src/**.spec.ts`.
 */

export type AttachmentKind = 'pdf' | 'docx' | 'image' | 'text' | 'unsupported';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

const DOCX_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function detectAttachmentKind(contentType: string, filename = ''): AttachmentKind {
  const ct = (contentType || '').toLowerCase();
  const ext = filename.toLowerCase().includes('.') ? filename.toLowerCase().split('.').pop()! : '';
  if (ct === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ct === DOCX_CT || ext === 'docx') return 'docx';
  if (ct.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext))
    return 'image';
  if (ct.startsWith('text/') || ['txt', 'md', 'csv'].includes(ext)) return 'text';
  return 'unsupported';
}

/** True for kinds whose text we can currently extract server-side. */
export function isExtractableKind(kind: AttachmentKind): boolean {
  return kind === 'docx' || kind === 'text';
}

export interface AttachmentValidation {
  ok: boolean;
  reason: string | null;
  kind: AttachmentKind;
}

export function validateAttachment(input: {
  contentType: string;
  byteSize: number;
  filename?: string;
}): AttachmentValidation {
  const kind = detectAttachmentKind(input.contentType, input.filename);
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, reason: 'Empty file', kind };
  }
  if (input.byteSize > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: `File exceeds the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB limit`,
      kind,
    };
  }
  if (kind === 'unsupported') return { ok: false, reason: 'Unsupported file type', kind };
  return { ok: true, reason: null, kind };
}

/** Wrap extracted text for injection into the chat context, clamped. */
export function formatAttachmentContext(filename: string, text: string, maxChars = 8000): string {
  const trimmed = text.trim();
  const clipped =
    trimmed.length > maxChars ? `${trimmed.slice(0, maxChars).trimEnd()}\n…[truncated]` : trimmed;
  return `Attached document "${filename || 'untitled'}":\n${clipped}`;
}
