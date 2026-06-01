/**
 * Manual smoke test for P0-1 (Anthropic prompt caching).
 *
 * Verifies the cache-breakpoint mechanism end-to-end against the live Anthropic
 * API: it builds a `system` (with a cache breakpoint on the static base) and a
 * `tools` block (breakpoint on the last tool) exactly the way clio.service.ts
 * does — via the shared pure helpers — then sends two identical requests and
 * asserts the SECOND reports `cache_read_input_tokens > 0`.
 *
 * This is NOT a jest test (jest only scans src/ **.spec.ts). It hits the live
 * API, so it is never run in CI. Run manually with a real key:
 *
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @capiro/api exec tsx test/smoke/clio-prompt-cache.smoke.ts
 *
 * Exit code 0 = cache hit observed on turn 2; 1 = no cache hit / error.
 */
import {
  applyToolCacheControl,
  buildClioSystemBlocks,
} from '../../src/clio/clio-prompt.helpers.js';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLIO_MODEL ?? 'claude-sonnet-4-6';

// A static system base large enough to exceed Anthropic's minimum cacheable
// prefix (~1024 tokens for Sonnet/Opus). In production the real Clio base plus
// the 22 tool schemas clear this comfortably; here we pad deterministically.
const SYSTEM_BASE = [
  'You are Clio, an elite AI chief of staff for government affairs professionals.',
  'The following are standing operating instructions that never change between turns.',
  ...Array.from(
    { length: 60 },
    (_, i) =>
      `Standing instruction ${i + 1}: prefer authoritative Capiro internal sources over public web; ` +
      'cite specifics (bill numbers, sponsors, filing IDs); never fabricate figures; be concise and analytical.',
  ),
].join('\n');

// A representative static tool block. The last entry carries the breakpoint.
const TOOLS = Array.from({ length: 8 }, (_, i) => ({
  name: `search_source_${i + 1}`,
  description:
    `Search authoritative source #${i + 1}. ` +
    'Returns structured records with titles, dates, identifiers, and short summaries for grounding.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text query' },
      limit: { type: 'integer', description: 'Max results (1-50)' },
    },
    required: ['query'],
  },
}));

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

async function callOnce(turn: number): Promise<AnthropicUsage> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY as string,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 64,
      system: buildClioSystemBlocks({ base: SYSTEM_BASE, cacheEnabled: true }),
      tools: applyToolCacheControl(TOOLS, true),
      messages: [{ role: 'user', content: 'Reply with the single word: ready.' }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { usage?: AnthropicUsage };
  const usage = json.usage ?? {};
  console.log(
    `turn ${turn}: input=${usage.input_tokens ?? 0} ` +
      `cache_creation=${usage.cache_creation_input_tokens ?? 0} ` +
      `cache_read=${usage.cache_read_input_tokens ?? 0} ` +
      `output=${usage.output_tokens ?? 0}`,
  );
  return usage;
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('ANTHROPIC_API_KEY is required to run this smoke test.');
    process.exit(1);
  }
  console.log(
    `Model: ${MODEL}\nSending 2 identical turns; expecting cache_read > 0 on turn 2...\n`,
  );
  await callOnce(1); // primes the cache (expect cache_creation > 0)
  const second = await callOnce(2); // should hit the cache
  const cacheRead = second.cache_read_input_tokens ?? 0;
  if (cacheRead > 0) {
    console.log(`\nPASS: turn 2 read ${cacheRead} tokens from cache.`);
    process.exit(0);
  }
  console.error(
    '\nFAIL: turn 2 reported no cache_read tokens. Check model min-cacheable length / TTL.',
  );
  process.exit(1);
}

void main();
