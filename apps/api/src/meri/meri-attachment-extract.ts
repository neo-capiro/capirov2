/**
 * PDF text extraction I/O for Meri attachments (assistant-parity F1).
 *
 * Separated from the service so the manual attachment eval
 * (scripts/eval-clio-attachments.ts) exercises the exact same extraction the
 * upload endpoint uses. unpdf (pdf.js under the hood, no native binaries);
 * page and character caps bound parser CPU, and every page boundary is an
 * await so a large document never monopolizes the event loop.
 */

import { getDocumentProxy } from 'unpdf';
import { DOC_TEXT_MAX_CHARS, PDF_MAX_PAGES } from './meri-attachment.helpers.js';

export interface PdfExtraction {
  text: string;
  pages: number;
}

export async function extractPdfText(buffer: Buffer | Uint8Array): Promise<PdfExtraction> {
  const bytes = buffer instanceof Uint8Array && !(buffer instanceof Buffer)
    ? buffer
    : new Uint8Array(buffer);
  const pdf = await getDocumentProxy(bytes);
  const pageCount = Math.min(pdf.numPages, PDF_MAX_PAGES);
  const parts: string[] = [];
  let chars = 0;
  for (let i = 1; i <= pageCount && chars < DOC_TEXT_MAX_CHARS; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = (content.items as Array<{ str?: string }>)
      .map((item) => item.str ?? '')
      .join(' ');
    parts.push(pageText);
    chars += pageText.length;
  }
  return { text: parts.join('\n'), pages: pdf.numPages };
}
