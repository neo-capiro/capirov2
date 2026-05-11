export function markdownHeading(level: 1 | 2 | 3, text: string): string {
  return `${'#'.repeat(level)} ${normalizeInline(text)}`;
}

export function markdownList(items: string[]): string[] {
  return items.map((item) => `- ${normalizeInline(item)}`);
}

export function normalizeInline(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeBlock(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderLink(label: string, url: string): string {
  return `[${normalizeInline(label)}](${normalizeInline(url)})`;
}

