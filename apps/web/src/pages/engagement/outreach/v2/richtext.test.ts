// Locks the HTML trust boundary for Generate & Review: the sanitizer must
// strip XSS vectors, and the markdown→HTML bridge must never emit a dangerous
// attribute. (jsdom provides DOMParser/document for sanitizeHtml.)

import { describe, expect, it } from 'vitest';
import { htmlToPlainText, looksLikeHtml, markdownishToHtml, sanitizeHtml } from './richtext.js';

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
