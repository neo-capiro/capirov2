/**
 * Attachment Q&A + vision eval (assistant-parity F1).
 * `pnpm --filter @capiro/api eval:clio:attachments`
 *
 * Renders the fixture documents (src/clio/evals/attachment-fixtures.ts) into
 * REAL files — text PDFs via pdf-lib, a docx via the docx package, plain
 * text, deterministic PNGs via a tiny built-in encoder — then runs the exact
 * production extraction/validation pipeline (the same helpers + unpdf
 * extractor the upload endpoint uses) and asks the live model the fixture
 * questions, grading by substring match. Vision cases attach the PNG as a
 * native Anthropic image block, proving the vision round-trip.
 *
 * Also measures PDF extraction latency over a generated 150-page text PDF
 * (worst-case page cap) and reports it against the < 5s criterion.
 *
 * Gates (exit non-zero when unmet):
 *   Q&A accuracy >= CLIO_ATTACHMENT_EVAL_MIN_PASS (default 0.9)
 *   all failure scenarios produce their explicit status (scanned/unsupported)
 *   150-page extraction < 5000 ms
 *
 * Requires ANTHROPIC_API_KEY. Live API, manual gate — not CI.
 */
import 'dotenv/config';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Document, Packer, Paragraph } from 'docx';
import {
  ATTACHMENT_DOC_FIXTURES,
  ATTACHMENT_FAILURE_FIXTURES,
  ATTACHMENT_IMAGE_FIXTURES,
  type AttachmentImageFixture,
} from '../src/meri/evals/attachment-fixtures.js';
import {
  MAX_ATTACHMENT_BYTES,
  formatAttachmentContext,
  resolveDocumentStatus,
  validateAttachment,
  verifyMagicBytes,
  type AttachmentStatus,
} from '../src/meri/meri-attachment.helpers.js';
import { extractPdfText } from '../src/meri/meri-attachment-extract.js';
import mammoth from 'mammoth';

const API_URL = 'https://api.anthropic.com/v1/messages';
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLIO_MODEL ?? 'claude-sonnet-4-6';
const PASS_GATE = Number(process.env.CLIO_ATTACHMENT_EVAL_MIN_PASS ?? '0.9');

// ── Tiny deterministic PNG encoder (RGB, 8-bit, filter 0) ─────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGB pixel grid (rows of [r,g,b] triples) as a PNG. */
function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0; // filter: none
    for (let x = 0; x < width * 3; x += 1) {
      raw[y * (1 + width * 3) + 1 + x] = pixels[y * width * 3 + x] as number;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderEvalPng(scene: AttachmentImageFixture['scene']): Buffer {
  const W = 120;
  const H = 120;
  const px = new Uint8Array(W * H * 3).fill(255); // white background
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * W + x) * 3;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  };
  if (scene === 'three-bars') {
    // Left bar short, middle medium, RIGHT tallest (dark blue bars).
    const bars = [
      { x0: 10, h: 30 },
      { x0: 50, h: 60 },
      { x0: 90, h: 100 },
    ];
    for (const bar of bars) {
      for (let x = bar.x0; x < bar.x0 + 20; x += 1) {
        for (let y = H - 10 - bar.h; y < H - 10; y += 1) set(x, y, 20, 40, 160);
      }
    }
  } else if (scene === 'red-circle') {
    const cx = 60;
    const cy = 60;
    const r = 35;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, 220, 30, 30);
      }
    }
  } else {
    // 2x2 grid: top-left BLUE, top-right yellow, bottom-left green, bottom-right black.
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const top = y < H / 2;
        const left = x < W / 2;
        if (top && left) set(x, y, 20, 60, 220);
        else if (top && !left) set(x, y, 235, 215, 40);
        else if (!top && left) set(x, y, 30, 160, 60);
        else set(x, y, 15, 15, 15);
      }
    }
  }
  return encodePng(W, H, px);
}

// ── Document renderers ─────────────────────────────────────────────────────

async function renderPdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage([612, 792]);
  let y = 740;
  for (const line of lines) {
    if (y < 60) {
      page = doc.addPage([612, 792]);
      y = 740;
    }
    page.drawText(line, { x: 50, y, size: 11, font, color: rgb(0, 0, 0) });
    y -= 18;
  }
  return Buffer.from(await doc.save());
}

async function renderScannedLikePdf(): Promise<Buffer> {
  // A page with drawings but NO text layer — what a scan looks like to a parser.
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 40, y: 80, width: 530, height: 640, color: rgb(0.92, 0.9, 0.86) });
  page.drawRectangle({ x: 60, y: 600, width: 480, height: 8, color: rgb(0.4, 0.4, 0.4) });
  page.drawRectangle({ x: 60, y: 570, width: 440, height: 8, color: rgb(0.4, 0.4, 0.4) });
  return Buffer.from(await doc.save());
}

async function renderLargePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p += 1) {
    const page = doc.addPage([612, 792]);
    for (let i = 0; i < 38; i += 1) {
      page.drawText(
        `Page ${p + 1} line ${i + 1}: appropriations report language for fiscal year 2027, item ${p * 38 + i}.`,
        { x: 40, y: 750 - i * 19, size: 10, font },
      );
    }
  }
  return Buffer.from(await doc.save());
}

async function renderDocx(lines: string[]): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: lines.map((line) => new Paragraph(line)) }],
  });
  return Packer.toBuffer(doc);
}

// ── Pipeline (mirrors MeriService.uploadAttachment minus persistence) ──────

interface PipelineResult {
  status: AttachmentStatus;
  text: string | null;
  reason: string | null;
}

async function runExtractionPipeline(
  filename: string,
  contentType: string,
  buffer: Buffer,
): Promise<PipelineResult> {
  const validation = validateAttachment({ contentType, byteSize: buffer.length, filename });
  if (!validation.ok) return { status: 'unsupported', text: null, reason: validation.reason };
  const magic = verifyMagicBytes(validation.kind, new Uint8Array(buffer.subarray(0, 256)));
  if (!magic.ok) return { status: 'unsupported', text: null, reason: magic.reason };
  if (validation.kind === 'image') return { status: 'image_ready', text: null, reason: null };
  let raw = '';
  try {
    if (validation.kind === 'text') raw = buffer.toString('utf8');
    else if (validation.kind === 'docx') raw = (await mammoth.extractRawText({ buffer })).value;
    else if (validation.kind === 'pdf') raw = (await extractPdfText(buffer)).text;
  } catch (err) {
    return {
      status: 'unsupported',
      text: null,
      reason: `parse failure: ${err instanceof Error ? err.message : err}`,
    };
  }
  const resolved = resolveDocumentStatus(validation.kind, raw);
  return { status: resolved.status, text: resolved.text, reason: resolved.reason };
}

// ── Model calls ────────────────────────────────────────────────────────────

async function askWithText(question: string, filename: string, text: string): Promise<string> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': KEY as string,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system:
        'You are Meri, an AI chief of staff for federal lobbyists. Answer strictly from the attached document.',
      messages: [
        { role: 'user', content: `${formatAttachmentContext(filename, text)}\n\nQuestion: ${question}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
}

async function askWithImage(question: string, png: Buffer): Promise<string> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': KEY as string,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
            },
            { type: 'text', text: question },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
}

// ── Runner ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!KEY) {
    console.error('ANTHROPIC_API_KEY is required (set it in apps/api/.env or the environment).');
    process.exit(2);
  }

  const results: Array<{ id: string; kind: string; pass: boolean; note?: string }> = [];
  const record = (id: string, kind: string, pass: boolean, note?: string) => {
    results.push({ id, kind, pass, note });
    console.log(`${pass ? 'PASS' : 'FAIL'}  [${kind}] ${id}${note && !pass ? `  — ${note}` : ''}`);
  };

  // 1) Document Q&A through the real extraction pipeline.
  const renderedDocs = new Map<string, Buffer>();
  for (const f of ATTACHMENT_DOC_FIXTURES) {
    try {
      let buffer = renderedDocs.get(f.filename);
      if (!buffer) {
        buffer =
          f.format === 'pdf'
            ? await renderPdf(f.lines)
            : f.format === 'docx'
              ? await renderDocx(f.lines)
              : Buffer.from(f.lines.join('\n'), 'utf8');
        renderedDocs.set(f.filename, buffer);
      }
      const contentType =
        f.format === 'pdf'
          ? 'application/pdf'
          : f.format === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'text/plain';
      const extracted = await runExtractionPipeline(f.filename, contentType, buffer);
      if (!extracted.text) {
        record(f.id, 'doc-qa', false, `extraction failed: ${extracted.reason ?? extracted.status}`);
        continue;
      }
      const answer = await askWithText(f.question, f.filename, extracted.text);
      const pass = f.mustInclude.every((s) => answer.toLowerCase().includes(s.toLowerCase()));
      record(f.id, 'doc-qa', pass, pass ? undefined : `answer: ${answer.slice(0, 160)}`);
    } catch (err) {
      record(f.id, 'doc-qa', false, err instanceof Error ? err.message : String(err));
    }
  }

  // 2) Vision round-trips.
  for (const f of ATTACHMENT_IMAGE_FIXTURES) {
    try {
      const png = renderEvalPng(f.scene);
      const pipeline = await runExtractionPipeline(f.filename, 'image/png', png);
      if (pipeline.status !== 'image_ready') {
        record(f.id, 'vision', false, `expected image_ready, got ${pipeline.status}`);
        continue;
      }
      const answer = await askWithImage(f.question, png);
      const pass = f.mustInclude.every((s) => answer.toLowerCase().includes(s.toLowerCase()));
      record(f.id, 'vision', pass, pass ? undefined : `answer: ${answer.slice(0, 160)}`);
    } catch (err) {
      record(f.id, 'vision', false, err instanceof Error ? err.message : String(err));
    }
  }

  // 3) Explicit-failure scenarios (no tokens needed).
  for (const f of ATTACHMENT_FAILURE_FIXTURES) {
    try {
      let result: PipelineResult;
      if (f.scenario === 'scanned-pdf') {
        result = await runExtractionPipeline('scan.pdf', 'application/pdf', await renderScannedLikePdf());
      } else if (f.scenario === 'oversized') {
        result = await runExtractionPipeline(
          'huge.pdf',
          'application/pdf',
          Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x25),
        );
      } else {
        result = await runExtractionPipeline(
          'fake.pdf',
          'application/pdf',
          Buffer.from('<!DOCTYPE html><html><body>not a pdf</body></html>', 'utf8'),
        );
      }
      const pass = result.status === f.expectStatus && Boolean(result.reason);
      record(
        f.id,
        'failure-visibility',
        pass,
        pass ? undefined : `status=${result.status} reason=${result.reason ?? '(none)'}`,
      );
    } catch (err) {
      record(f.id, 'failure-visibility', false, err instanceof Error ? err.message : String(err));
    }
  }

  // 4) Extraction latency at the page cap (150 pages of dense text).
  const large = await renderLargePdf(150);
  const started = Date.now();
  const extraction = await extractPdfText(large);
  const elapsedMs = Date.now() - started;
  const latencyPass = elapsedMs < 5000;
  console.log(
    `\n150-page PDF (${(large.length / 1024).toFixed(0)} KB): extracted ${extraction.text.length} chars ` +
      `from ${extraction.pages} pages in ${elapsedMs} ms ${latencyPass ? '(< 5s criterion met)' : '(EXCEEDS 5s)'}`,
  );

  const passed = results.filter((r) => r.pass).length;
  const passRate = passed / results.length;
  const reportUrl = new URL('../test/evals/clio/attachments-last-report.json', import.meta.url);
  mkdirSync(dirname(fileURLToPath(reportUrl)), { recursive: true });
  writeFileSync(
    reportUrl,
    JSON.stringify({ model: MODEL, passRate, extractionMs: elapsedMs, results }, null, 2),
  );

  console.log(`\n=== Attachment eval summary ===`);
  console.log(`pass ${passed}/${results.length} (${(passRate * 100).toFixed(1)}%)`);
  const gatePass = passRate >= PASS_GATE && latencyPass;
  console.log(gatePass ? '\nGATE: PASS' : `\nGATE: FAIL (need >=${PASS_GATE * 100}% and <5s extraction)`);
  process.exit(gatePass ? 0 : 1);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
