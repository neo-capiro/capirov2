/**
 * Pre-flight check for the ingestion pipeline. Reports which external API keys
 * are present vs missing, classified by whether the dependent sync HARD-requires
 * the key (the script throws without it) or merely degrades (keyless/rate-limited).
 *
 *   tsx scripts/preflight-ingestion.ts            # human report, exit 1 if a REQUIRED key is missing
 *   tsx scripts/preflight-ingestion.ts --json     # machine-readable
 *   tsx scripts/preflight-ingestion.ts --warn-only # never exit non-zero
 *
 * Run this BEFORE a backfill (scripts/backfill-all.ts) or before creating the
 * EventBridge schedules, so a missing key fails fast instead of mid-run.
 *
 * Key classifications are derived from the actual scripts (verified 2026-06-01):
 *   REQUIRED (script throws): FEC_API_KEY, OPENSTATES_API_KEY, SAM_GOV_API_KEY,
 *     OPENAI_API_KEY (generate-briefings).
 *   RECOMMENDED (degrades/rate-limited without it): CONGRESS_API_KEY,
 *     REGULATIONS_GOV_API_KEY, LDA_API_KEY, FIRECRAWL_API_KEY (PE url discovery),
 *     ANTHROPIC_API_KEY (clio/briefings fallback).
 *   Embeddings use the ECS task role for Bedrock — no key (EMBEDDINGS_MODEL optional).
 */
import { parseArgs } from 'node:util';

interface KeyCheck {
  env: string;
  level: 'required' | 'recommended';
  usedBy: string;
  note: string;
}

const KEYS: KeyCheck[] = [
  { env: 'FEC_API_KEY', level: 'required', usedBy: 'sync-fec, sync-fec-pac', note: 'script throws without it' },
  { env: 'OPENSTATES_API_KEY', level: 'required', usedBy: 'sync-openstates', note: 'script throws without it' },
  { env: 'SAM_GOV_API_KEY', level: 'required', usedBy: 'sync-sam-personnel', note: 'script throws without it' },
  { env: 'OPENAI_API_KEY', level: 'required', usedBy: 'generate-briefings', note: 'briefings abort without it' },
  { env: 'CONGRESS_API_KEY', level: 'recommended', usedBy: 'sync-congress', note: 'keyless = heavy rate limiting' },
  { env: 'REGULATIONS_GOV_API_KEY', level: 'recommended', usedBy: 'sync-regulations', note: 'warns + likely throttled without it' },
  { env: 'LDA_API_KEY', level: 'recommended', usedBy: 'sync-lda', note: 'adds auth header if present; higher limits' },
  { env: 'FIRECRAWL_API_KEY', level: 'recommended', usedBy: 'PE .mil URL discovery (jbooks/orgcharts)', note: 'WAF unlock for finding source URLs' },
  { env: 'ANTHROPIC_API_KEY', level: 'recommended', usedBy: 'clio, briefings fallback', note: 'LLM features degrade without it' },
];

const { values } = parseArgs({
  options: {
    json: { type: 'boolean' },
    'warn-only': { type: 'boolean' },
  },
});

function present(env: string): boolean {
  const v = process.env[env];
  return typeof v === 'string' && v.trim().length > 0;
}

function main(): void {
  const results = KEYS.map((k) => ({ ...k, present: present(k.env) }));
  const missingRequired = results.filter((r) => r.level === 'required' && !r.present);
  const missingRecommended = results.filter((r) => r.level === 'recommended' && !r.present);

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          ok: missingRequired.length === 0,
          missingRequired: missingRequired.map((r) => r.env),
          missingRecommended: missingRecommended.map((r) => r.env),
          results,
        },
        null,
        2,
      ),
    );
  } else {
    console.log('=== Ingestion pre-flight: external API keys ===\n');
    for (const r of results) {
      const mark = r.present ? 'OK  ' : r.level === 'required' ? 'MISS' : 'warn';
      console.log(`[${mark}] ${r.env.padEnd(24)} (${r.level})  ${r.usedBy}`);
      if (!r.present) console.log(`        -> ${r.note}`);
    }
    console.log('');
    if (missingRequired.length > 0) {
      console.log(`FAIL: ${missingRequired.length} REQUIRED key(s) missing: ${missingRequired.map((r) => r.env).join(', ')}`);
      console.log('Create each as a secret (capiro/dev/<name>, no leading slash) and wire into the task env.');
    } else {
      console.log('PASS: all required keys present.');
    }
    if (missingRecommended.length > 0) {
      console.log(`Note: ${missingRecommended.length} recommended key(s) missing (degraded, not fatal): ${missingRecommended.map((r) => r.env).join(', ')}`);
    }
  }

  if (!values['warn-only'] && missingRequired.length > 0) {
    process.exit(1);
  }
}

main();
