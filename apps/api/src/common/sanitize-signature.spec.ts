import { describe, expect, test } from '@jest/globals';
import { MAX_SIGNATURE_HTML_LENGTH, sanitizeSignatureHtml } from './sanitize-signature.js';

describe('sanitizeSignatureHtml', () => {
  test('returns empty string for empty / whitespace / empty-tag-only input', () => {
    expect(sanitizeSignatureHtml('')).toBe('');
    expect(sanitizeSignatureHtml(null)).toBe('');
    expect(sanitizeSignatureHtml(undefined)).toBe('');
    expect(sanitizeSignatureHtml('   \n  ')).toBe('');
    expect(sanitizeSignatureHtml('<p></p><div>   </div>')).toBe('');
  });

  test('strips <script> and its content', () => {
    const out = sanitizeSignatureHtml('<p>Hi</p><script>alert(1)</script>');
    expect(out).toContain('Hi');
    expect(out).not.toMatch(/script/i);
    expect(out).not.toContain('alert(1)');
  });

  test('strips <style> blocks and inline event handlers', () => {
    const out = sanitizeSignatureHtml(
      '<style>.x{color:red}</style><p onclick="steal()" onmouseover="x()">Name</p>',
    );
    expect(out).toContain('Name');
    expect(out).not.toMatch(/onclick|onmouseover|steal|<style/i);
  });

  test('keeps formatting, links — forces target/rel, drops javascript: href', () => {
    const out = sanitizeSignatureHtml(
      '<p><strong>Sarah Mitchell</strong><br><a href="https://x.com">site</a> ' +
        '<a href="javascript:alert(1)">evil</a> <a href="mailto:s@x.com">mail</a></p>',
    );
    expect(out).toContain('<strong>Sarah Mitchell</strong>');
    expect(out).toContain('href="https://x.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('href="mailto:s@x.com"');
    expect(out).not.toContain('javascript:');
  });

  test('keeps https image and base64 raster data-URI image (logos)', () => {
    const https = sanitizeSignatureHtml('<img src="https://cdn.x.com/logo.png" alt="Logo" width="120">');
    expect(https).toContain('src="https://cdn.x.com/logo.png"');
    expect(https).toContain('alt="Logo"');
    expect(https).toContain('width="120"');

    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const data = sanitizeSignatureHtml(`<img src="${dataUri}" alt="inline">`);
    expect(data).toContain(dataUri);
  });

  test('drops svg data-URI images and non-image data URIs', () => {
    const svg = sanitizeSignatureHtml('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="x">');
    expect(svg).not.toContain('data:image/svg');
    const htmlData = sanitizeSignatureHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">');
    expect(htmlData).not.toContain('data:text/html');
  });

  test('a lone valid image is preserved (not treated as empty)', () => {
    const out = sanitizeSignatureHtml('<img src="https://cdn.x.com/logo.png">');
    expect(out).toContain('<img');
    expect(out).toContain('https://cdn.x.com/logo.png');
  });

  test('preserves simple table layout and font tags (Outlook-style signatures)', () => {
    const out = sanitizeSignatureHtml(
      '<table><tbody><tr><td><font color="#1a3f9f">Pinnacle</font></td></tr></tbody></table>',
    );
    expect(out).toContain('<table>');
    expect(out).toContain('<td>');
    expect(out).toContain('Pinnacle');
  });

  test('keeps allowlisted inline styles, scrubs dangerous ones', () => {
    const out = sanitizeSignatureHtml(
      '<span style="color:#1a3f9f;font-weight:bold;position:fixed;background-image:url(http://evil)">x</span>',
    );
    expect(out).toMatch(/color:\s*#1a3f9f/i);
    expect(out).toMatch(/font-weight:\s*bold/i);
    expect(out).not.toMatch(/position/i);
    expect(out).not.toMatch(/background-image|url\(/i);
  });

  test('border/border-top styles reject url()/expression(), keep plain borders', () => {
    const evil = sanitizeSignatureHtml(
      '<div style="border:1px solid url(//evil)">a</div>' +
        '<span style="border-top:expression(alert(1))">b</span>',
    );
    expect(evil).not.toMatch(/url\(|expression\(/i);
    const ok = sanitizeSignatureHtml('<div style="border:1px solid #1a3f9f">a</div>');
    expect(ok).toMatch(/border:\s*1px solid #1a3f9f/i);
  });

  test('truncates input beyond the max length', () => {
    const huge = '<p>' + 'a'.repeat(MAX_SIGNATURE_HTML_LENGTH + 50_000) + '</p>';
    const out = sanitizeSignatureHtml(huge);
    expect(out.length).toBeLessThanOrEqual(MAX_SIGNATURE_HTML_LENGTH + 20);
  });
});
