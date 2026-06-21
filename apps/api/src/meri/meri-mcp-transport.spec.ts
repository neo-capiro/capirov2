import { describe, expect, test } from '@jest/globals';
import { stdioCommandAllowed } from './meri-mcp-transport.js';

describe('stdio command allowlist (F6a security boundary)', () => {
  test('refuses everything when no allowlist is configured (default)', () => {
    expect(stdioCommandAllowed('node', undefined)).toBe(false);
    expect(stdioCommandAllowed('node', '')).toBe(false);
  });

  test('allows only exact allowlisted commands', () => {
    const csv = '/usr/local/bin/mcp-files, /usr/local/bin/mcp-git';
    expect(stdioCommandAllowed('/usr/local/bin/mcp-files', csv)).toBe(true);
    expect(stdioCommandAllowed('/usr/local/bin/mcp-git', csv)).toBe(true);
    expect(stdioCommandAllowed('/usr/local/bin/mcp-files --evil', csv)).toBe(false);
    expect(stdioCommandAllowed('/bin/sh', csv)).toBe(false);
    // No prefix/substring tricks.
    expect(stdioCommandAllowed('/usr/local/bin/mcp', csv)).toBe(false);
  });
});
