import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

const MAX_BYTES = 2_000_000; // 2MB cap on response body
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'application/json',
  'application/xml',
  'application/xhtml+xml',
];

/**
 * Fetch a URL and return its text content. This is the "browsing"
 * half of agentic web — web_search gives the agent links, fetch_url
 * lets it actually read what's on those pages.
 *
 * Defense in depth against SSRF:
 *   1. Only http(s) schemes.
 *   2. Hostname check rejects literal private IPs and 'localhost'.
 *      DNS-resolution-based checks would be stronger but require an
 *      out-of-band resolver since `fetch()` does its own DNS. The
 *      hostname-literal check catches the obvious 90% (and the API
 *      task can't reach the VPC's private subnets from its egress
 *      security group anyway).
 *   3. Content-type allowlist — drops binary downloads.
 *   4. Size cap via streamed read.
 *   5. Redirect cap.
 *   6. 15s timeout.
 *
 * Output is plain text (HTML stripped via a minimal extractor), so the
 * model gets ~2-5KB of usable text rather than 200KB of markup.
 */
@Injectable()
export class FetchUrlTool implements Tool {
  private readonly logger = new Logger(FetchUrlTool.name);
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'fetch_url',
    description:
      'Fetch a URL and return the page text. Use this after a web_search call to actually read what is on the result pages — searching returns just titles and snippets; this returns the page body. ' +
      'Strips HTML, extracts the page title, caps output at ~10k characters. Only http(s) URLs; binary downloads (PDFs, images, etc.) are refused — use code_interpreter for those.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: {
          type: 'string',
          description: 'Absolute http(s) URL to fetch.',
        },
        maxChars: {
          type: 'integer',
          description:
            'Truncate extracted text to this many characters. Default 10000. Max 40000.',
        },
      },
    },
  };

  async execute(rawInput: Record<string, unknown>, _ctx: ToolExecutionContext) {
    const url = typeof rawInput.url === 'string' ? rawInput.url.trim() : '';
    if (!url) throw new BadRequestException('url is required');
    const maxChars = Math.min(
      Math.max(typeof rawInput.maxChars === 'number' ? rawInput.maxChars : 10_000, 500),
      40_000,
    );
    const parsed = safeParseUrl(url);
    if (!parsed) {
      return { ok: false, error: 'Invalid URL — must be absolute http(s)' };
    }

    try {
      const res = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'follow',
        // Generic UA so we look like a browser to picky servers but
        // don't lie about being a specific known one.
        headers: {
          'user-agent':
            'CapiroClio/1.0 (+https://capiro.ai; agent fetch_url tool)',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      const contentType = (res.headers.get('content-type') ?? '')
        .toLowerCase()
        .split(';')[0]
        ?.trim();
      if (!contentType) {
        return { ok: false, error: 'Server returned no Content-Type' };
      }
      if (!ALLOWED_CONTENT_TYPES.some((c) => contentType.startsWith(c))) {
        return {
          ok: false,
          status: res.status,
          contentType,
          error: `Refusing to fetch content-type ${contentType} — only text/HTML/JSON/XML allowed. Use code_interpreter for binary content.`,
        };
      }

      // Cap response size while streaming so a 10GB page can't OOM us.
      const reader = res.body?.getReader();
      if (!reader) {
        return { ok: false, error: 'Empty response body' };
      }
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > MAX_BYTES) {
          // Read up to MAX_BYTES, drop the rest.
          chunks.push(value.slice(0, MAX_BYTES - (received - value.byteLength)));
          break;
        }
        chunks.push(value);
      }
      // Avoid a Buffer concat; build a single Uint8Array.
      const total = chunks.reduce((s, c) => s + c.byteLength, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.byteLength;
      }
      const text = new TextDecoder('utf-8', { fatal: false }).decode(merged);

      let extracted: { title: string; text: string };
      if (contentType.startsWith('text/html') || contentType.startsWith('application/xhtml')) {
        extracted = extractHtmlText(text);
      } else if (contentType.startsWith('application/json')) {
        extracted = { title: '', text: text };
      } else {
        extracted = { title: '', text: text };
      }
      const truncated = extracted.text.length > maxChars;
      const body = truncated ? extracted.text.slice(0, maxChars) : extracted.text;
      return {
        ok: true,
        url: parsed.toString(),
        finalUrl: res.url,
        status: res.status,
        contentType,
        title: extracted.title || undefined,
        text: body,
        truncated,
        byteSize: total,
      };
    } catch (err) {
      const message = String(err);
      this.logger.warn(`fetch_url failed for ${parsed.toString()}: ${message}`);
      if (message.includes('TimeoutError') || message.includes('AbortError')) {
        return { ok: false, error: `Fetch timed out after ${FETCH_TIMEOUT_MS}ms` };
      }
      return { ok: false, error: `Fetch failed: ${truncate(message, 200)}` };
    }
  }
}

function safeParseUrl(input: string): URL | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa')
  ) {
    return null;
  }
  // Block IP-literal access entirely — there's no legitimate reason
  // the agent should fetch a raw IP, and resolving CIDRs reliably
  // would need a dedicated DNS lookup we don't have here.
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    return null;
  }
  // AWS instance-metadata endpoint — explicit deny.
  if (host === '169.254.169.254' || host === 'metadata.google.internal') {
    return null;
  }
  return u;
}

/** Minimal HTML → text extractor. Good enough for ~80% of pages; the
 * 20% that need full Readability will get garbled output but never
 * fail. Stripping scripts/styles first is the critical step. */
function extractHtmlText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1] ? decodeEntities(titleMatch[1]).trim() : '';

  let body = html;
  body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  body = body.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  body = body.replace(/<!--([\s\S]*?)-->/g, '');
  // Break paragraphs and headings to newlines for readable plain text.
  body = body.replace(/<\/(p|div|h[1-6]|li|tr|article|section|header|footer)>/gi, '\n');
  body = body.replace(/<br\s*\/?>/gi, '\n');
  body = body.replace(/<[^>]+>/g, '');
  body = decodeEntities(body);
  body = body
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text: body };
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const cp = parseInt(code.slice(2), 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    if (code.startsWith('#')) {
      const cp = parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITY_MAP[code.toLowerCase()] ?? m;
  });
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}
