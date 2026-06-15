// Locks the HTML trust boundary for Generate & Review: the sanitizer must
// strip XSS vectors, and the markdown→HTML bridge must never emit a dangerous
// attribute. (jsdom provides DOMParser/document for sanitizeHtml.)

import { describe, expect, it } from 'vitest';
import {
  htmlToPlainText,
  looksLikeHtml,
  markdownishToHtml,
  sanitizeHtml,
  sanitizeSignatureHtml,
} from './richtext.js';

describe('sanitizeHtml', () => {
  it('drops <script> tags (keeps no executable markup)', () => {
    const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toMatch(/<script/i);
  });

  it('removes event-handler and style attributes', () => {
    const out = sanitizeHtml('<p onclick="evil()" style="color:red">hi</p>');
    expect(out).toBe('<p>hi</p>');
  });

  it('drops <img onerror> entirely (tag not allowlisted)', () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)">');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/<img/i);
  });

  it('strips javascript: and data: hrefs but keeps the anchor text', () => {
    const js = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(js).not.toMatch(/javascript:/i);
    expect(js).toContain('x');
    const data = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(data).not.toMatch(/data:/i);
  });

  it('keeps a safe http(s) link and hardens it with rel/target', () => {
    const out = sanitizeHtml('<a href="https://ok.com">x</a>');
    expect(out).toContain('href="https://ok.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('unwraps <svg>/<style> but preserves allowlisted formatting', () => {
    const out = sanitizeHtml('<svg><script>alert(1)</script></svg><strong>keep</strong>');
    expect(out).not.toMatch(/<svg|<script|<style/i);
    expect(out).toContain('<strong>keep</strong>');
  });
});

describe('sanitizeSignatureHtml', () => {
  it('drops <script>/<style> and event handlers but keeps formatting', () => {
    const out = sanitizeSignatureHtml(
      '<style>.x{}</style><p onclick="evil()"><strong>Sarah</strong></p><script>alert(1)</script>',
    );
    expect(out).not.toMatch(/<script|<style|onclick/i);
    expect(out).toContain('<strong>Sarah</strong>');
  });

  it('keeps https images and base64 raster logos, hardens links', () => {
    const out = sanitizeSignatureHtml(
      '<img src="https://cdn.x/logo.png" alt="logo"><a href="https://x.com">site</a>',
    );
    expect(out).toContain('src="https://cdn.x/logo.png"');
    expect(out).toContain('rel="noopener noreferrer"');
    const data =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    expect(sanitizeSignatureHtml(`<img src="${data}">`)).toContain(data);
  });

  it('removes <img onerror> handler but keeps the (safe) image', () => {
    const out = sanitizeSignatureHtml('<img src="https://cdn.x/a.png" onerror="alert(1)">');
    expect(out).not.toMatch(/onerror/i);
    expect(out).toContain('https://cdn.x/a.png');
  });

  it('strips images with unsafe/non-image src and javascript: links', () => {
    expect(sanitizeSignatureHtml('<img src="javascript:alert(1)">')).not.toMatch(/<img/i);
    expect(sanitizeSignatureHtml('<img src="data:text/html;base64,PHM+">')).not.toMatch(/<img/i);
    const js = sanitizeSignatureHtml('<a href="javascript:alert(1)">x</a>');
    expect(js).not.toMatch(/javascript:/i);
    expect(js).toContain('x');
  });

  it('preserves table layout and inline styles for branded signatures', () => {
    const out = sanitizeSignatureHtml(
      '<table><tr><td style="color:#1a3f9f">Pinnacle Federal</td></tr></table>',
    );
    expect(out).toContain('<table>');
    expect(out).toContain('<td');
    expect(out).toContain('Pinnacle Federal');
  });

  it('drops style attributes carrying url()/expression()', () => {
    const out = sanitizeSignatureHtml('<div style="background:url(http://evil)">x</div>');
    expect(out).not.toMatch(/url\(|background/i);
    expect(out).toContain('x');
  });
});

describe('markdownishToHtml', () => {
  it('converts bold/italic and paragraphs', () => {
    const out = markdownishToHtml('Hello **world** and *italics*');
    expect(out).toContain('<strong>world</strong>');
    expect(out).toContain('<em>italics</em>');
    expect(out.startsWith('<p>')).toBe(true);
  });

  it('builds bullet and ordered lists', () => {
    expect(markdownishToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(markdownishToHtml('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('renders a safe markdown link', () => {
    expect(markdownishToHtml('[hi](https://ok.com)')).toContain('<a href="https://ok.com">hi</a>');
  });

  it('never emits an event-handler attribute from a malicious link', () => {
    const out = markdownishToHtml('[hi](https://x" onmouseover="alert(1))');
    expect(out).not.toMatch(/<a[^>]*onmouseover/i);
  });

  it('passes through already-HTML input (re-edited drafts)', () => {
    expect(markdownishToHtml('<p>already</p>')).toBe('<p>already</p>');
  });
});

describe('looksLikeHtml / htmlToPlainText', () => {
  it('detects html', () => {
    expect(looksLikeHtml('<p>x</p>')).toBe(true);
    expect(looksLikeHtml('plain **md**')).toBe(false);
  });

  it('flattens html to readable text', () => {
    expect(htmlToPlainText('<p>line one</p><p>line two</p>')).toBe('line one\nline two');
  });
});
