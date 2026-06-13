// Rich-text helpers bridging the AI's markdown output, the WYSIWYG editor's
// HTML, and the Graph send body. No React/JSX — safe to import anywhere in
// apps/web. The editor stores sanitized HTML; the send path picks
// contentType:'HTML' vs 'Text' via looksLikeHtml().

// Tags the editor + sanitizer permit. Everything else is unwrapped (text kept)
// or dropped (script/style/comments), and ALL attributes are stripped except a
// safe href on <a>. This is the XSS/paste-junk guard for stored body HTML.
const ALLOWED_TAGS = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'P',
  'BR',
  'H2',
  'H3',
  'UL',
  'OL',
  'LI',
  'A',
  'BLOCKQUOTE',
  'DIV',
  'SPAN',
]);

export function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s);
}

function escapeHtml(s: string): string {
  // Escape quotes too — inline() reinserts a captured href into a quoted
  // attribute, so an unescaped " would allow attribute-breakout injection.
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape, then apply inline markdown (links, bold, italic) to one line. */
function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(
    // href excludes quotes (belt-and-suspenders with escapeHtml above).
    /\[([^\]]+)\]\((https?:\/\/[^\s)"']+|mailto:[^\s)"']+)\)/g,
    (_m, text, href) => `<a href="${href}">${text}</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

/**
 * Convert the AI's lightweight markdown into HTML for the WYSIWYG editor.
 * Handles headings (#/##/###), unordered (-,*) and ordered (1.) lists,
 * bold/italic, links, and blank-line paragraphs. Already-HTML input is passed
 * through (a re-edited draft is HTML, not markdown).
 */
export function markdownishToHtml(src: string): string {
  if (!src) return '';
  if (looksLikeHtml(src)) return src;

  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushPara = () => {
    if (paragraph.length) {
      html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
      paragraph = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);

    if (heading) {
      flushPara();
      closeList();
      const level = (heading[1] ?? '#').length >= 2 ? 3 : 2; // #/## → h2/h3 (capped at h3)
      html.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`);
    } else if (bullet) {
      flushPara();
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${inline(bullet[1] ?? '')}</li>`);
    } else if (ordered) {
      flushPara();
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${inline(ordered[1] ?? '')}</li>`);
    } else if (line.trim() === '') {
      flushPara();
      closeList();
    } else {
      closeList();
      paragraph.push(line);
    }
  }
  flushPara();
  closeList();
  return html.join('');
}

/** Recursively copy only allowed nodes/attributes into `out`. */
function cleanInto(node: Node, out: Node, doc: Document): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(doc.createTextNode(child.textContent ?? ''));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return; // drop comments etc.
    const el = child as Element;
    if (ALLOWED_TAGS.has(el.tagName)) {
      const clean = doc.createElement(el.tagName.toLowerCase());
      if (el.tagName === 'A') {
        const href = el.getAttribute('href') ?? '';
        if (/^(https?:|mailto:)/i.test(href)) {
          clean.setAttribute('href', href);
          clean.setAttribute('target', '_blank');
          clean.setAttribute('rel', 'noopener noreferrer');
        }
      }
      cleanInto(el, clean, doc);
      out.appendChild(clean);
    } else {
      // Disallowed element (script/style/font/etc.): keep its text, drop the tag.
      cleanInto(el, out, doc);
    }
  });
}

/** Strip the HTML down to the allowlist — run on editor input/paste. */
export function sanitizeHtml(html: string): string {
  if (typeof document === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out = doc.createElement('div');
  cleanInto(doc.body, out, doc);
  return out.innerHTML;
}

/** Flatten HTML to readable plaintext (for the saved record's summary body). */
export function htmlToPlainText(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, '');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll('p,div,li,h2,h3,br,blockquote').forEach((el) => {
    el.appendChild(doc.createTextNode('\n'));
  });
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}
