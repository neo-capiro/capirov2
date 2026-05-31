import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { execFile as execFileCb } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export interface DowDirectorySectionChunk {
  title: string;
  organization: string;
  pageStart: number;
  pageEnd: number;
  buffer: Buffer;
}

interface TocEntry {
  title: string;
  page: number;
}

@Injectable()
export class DowDirectorySectionSplitterService {
  private readonly logger = new Logger(DowDirectorySectionSplitterService.name);

  async splitIntoSections(pdfBuffer: Buffer): Promise<DowDirectorySectionChunk[]> {
    const pageCount = await this.getPageCount(pdfBuffer);

    // Large directories can contain noisy ToC/OCR artifacts that over-split.
    // Keep chunking bounded for predictable Firecrawl spend and runtime.
    if (pageCount >= 180) {
      return this.fallbackSplit(pdfBuffer, pageCount, 12);
    }

    const tocEntries = await this.extractTocEntries(pdfBuffer, pageCount);

    if (tocEntries.length === 0) {
      this.logger.warn('No ToC entries parsed; falling back to fixed-size sectioning');
      return this.fallbackSplit(pdfBuffer, pageCount, 8);
    }

    const sections: Array<{ title: string; start: number; end: number }> = [];
    for (let i = 0; i < tocEntries.length; i += 1) {
      const entry = tocEntries[i]!;
      const next = tocEntries[i + 1];
      const start = entry.page;
      const end = Math.min(pageCount, Math.max(start, (next?.page ?? pageCount + 1) - 1));
      if (start < 1 || start > pageCount || end < start) continue;
      sections.push({ title: entry.title, start, end });
    }

    if (sections.length === 0) {
      return this.fallbackSplit(pdfBuffer, pageCount, 8);
    }

    const chunks: DowDirectorySectionChunk[] = [];
    for (const section of sections) {
      const chunk = await this.copyPages(pdfBuffer, section.start, section.end);
      chunks.push({
        title: section.title,
        organization: this.deriveOrganization(section.title),
        pageStart: section.start,
        pageEnd: section.end,
        buffer: chunk,
      });
    }

    return chunks;
  }

  private async extractTocEntries(pdfBuffer: Buffer, pageCount: number): Promise<TocEntry[]> {
    const firstPages = await this.copyPages(pdfBuffer, 1, Math.min(24, pageCount));
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dow-toc-'));
    const tmpPdf = path.join(tmpDir, 'toc-pages.pdf');
    const tmpTxt = path.join(tmpDir, 'toc-pages.txt');

    try {
      await fs.writeFile(tmpPdf, firstPages);
      await execFile('pdftotext', ['-layout', tmpPdf, tmpTxt]);
      const text = await fs.readFile(tmpTxt, 'utf-8');

      const entries: TocEntry[] = [];
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const parsed = this.parseTocLine(line, pageCount);
        if (parsed) entries.push(parsed);
      }

      const unique = new Map<number, TocEntry>();
      for (const e of entries) {
        const existing = unique.get(e.page);
        if (!existing || e.title.length > existing.title.length) unique.set(e.page, e);
      }

      return Array.from(unique.values()).sort((a, b) => a.page - b.page);
    } catch (error) {
      this.logger.warn(`ToC extraction via pdftotext failed: ${(error as Error).message}`);
      return [];
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  private parseTocLine(line: string, pageCount: number): TocEntry | null {
    const dotMatch = line.match(/^(.+?)\s\.{2,}\s*(\d{1,4})$/);
    const looseMatch = line.match(/^(.+?)\s+(\d{1,4})$/);
    const match = dotMatch ?? looseMatch;
    if (!match) return null;

    const title = match[1]!.replace(/\s+/g, ' ').trim();
    const page = Number.parseInt(match[2]!, 10);

    if (!title || !Number.isFinite(page) || page < 1 || page > pageCount) return null;
    if (title.length < 4 || !/[A-Za-z]/.test(title)) return null;
    if (/^table of contents$/i.test(title)) return null;
    if (/^page$/i.test(title)) return null;

    return { title, page };
  }

  private deriveOrganization(title: string): string {
    return title
      .replace(/\b(section|office|committee|directorate)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async fallbackSplit(pdfBuffer: Buffer, pageCount: number, chunkSize: number): Promise<DowDirectorySectionChunk[]> {
    const chunks: DowDirectorySectionChunk[] = [];
    for (let start = 1; start <= pageCount; start += chunkSize) {
      const end = Math.min(pageCount, start + chunkSize - 1);
      const buffer = await this.copyPages(pdfBuffer, start, end);
      chunks.push({
        title: `Section ${start}-${end}`,
        organization: 'UNKNOWN',
        pageStart: start,
        pageEnd: end,
        buffer,
      });
    }
    return chunks;
  }

  private async copyPages(pdfBuffer: Buffer, pageStart: number, pageEnd: number): Promise<Buffer> {
    const source = await PDFDocument.load(pdfBuffer);
    const out = await PDFDocument.create();
    const pageIndexes: number[] = [];
    for (let p = pageStart; p <= pageEnd; p += 1) pageIndexes.push(p - 1);
    const copied = await out.copyPages(source, pageIndexes);
    copied.forEach((page) => out.addPage(page));
    return Buffer.from(await out.save());
  }

  private async getPageCount(pdfBuffer: Buffer): Promise<number> {
    const pdf = await PDFDocument.load(pdfBuffer);
    return pdf.getPageCount();
  }
}
