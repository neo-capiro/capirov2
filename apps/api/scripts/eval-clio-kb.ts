/**
 * Client knowledge base retrieval + answer eval (assistant-parity F5).
 * `pnpm --filter @capiro/api eval:clio:kb`
 *
 * Builds the Meridian Aerostructures corpus (src/clio/evals/kb-fixtures.ts)
 * IN MEMORY with the PRODUCTION KB text builders + chunker, embeds every row
 * with the production Titan embedder (embedText/normalize), then for each of
 * the 30 questions: embeds the question, retrieves cosine top-6 rows, formats
 * them like the search_client_knowledge tool output, prepends the production
 * buildKbSnapshot, asks CLIO_MODEL, and grades by substring match — every
 * mustInclude present (case-insensitive) AND at least one [n] citation.
 * Retrieval quality is tracked separately as retrieval@6 (whether any top-6
 * row has the question's expected source kind).
 *
 * Requires ANTHROPIC_API_KEY (+ CLIO_MODEL) and AWS credentials with Bedrock
 * access for Titan embeddings. If embedText throws, the runner falls back to
 * keyword scoring (matched query terms / terms) — clearly labeled in the
 * output and the JSON report, since that no longer reflects pgvector quality.
 * Live API, manual gate — not CI.
 *
 * Gate (exit non-zero when unmet):
 *   pass-rate >= CLIO_KB_EVAL_MIN_PASS (default 0.9)
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KB_EVAL_QUESTIONS,
  buildKbEvalCorpus,
  buildKbEvalSnapshot,
  type KbCorpusRow,
} from '../src/meri/evals/kb-fixtures.js';
import { embedText, normalize } from '../src/embeddings/embedder.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLIO_MODEL ?? 'claude-sonnet-4-6';
const PASS_GATE = Number(process.env.CLIO_KB_EVAL_MIN_PASS ?? '0.9');
const TOP_K = 6;

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

async function complete(model: string, system: string, user: string, maxTokens = 800): Promise<string> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': KEY as string,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as AnthropicResponse;
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
    .trim();
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Fallback when Bedrock is unavailable: matched query terms / terms. */
function keywordScore(query: string, text: string): number {
  const terms = [...new Set(query.toLowerCase().split(/[^a-z0-9$.&-]+/).filter((t) => t.length > 2))];
  if (terms.length === 0) return 0;
  const hay = text.toLowerCase();
  return terms.filter((t) => hay.includes(t)).length / terms.length;
}

const SYSTEM_PROMPT = [
  'You are Meri, an AI chief of staff for U.S. federal lobbyists, answering from the client knowledge base.',
  'Use ONLY the knowledge-base snapshot and the numbered search_client_knowledge results provided.',
  'Cite every factual claim inline with [n] matching the result number.',
  'Quote names, identifiers, codes, congressional districts, dollar figures, and dates exactly as they appear in the sources.',
  'If the provided entries do not support an answer, say so plainly rather than guessing.',
].join(' ');

/** Numbered list, kind + text — the shape the search_client_knowledge tool feeds the model. */
function renderKbResults(rows: KbCorpusRow[]): string {
  return (
    'search_client_knowledge results:\n' +
    rows.map((r, i) => `[${i + 1}] (${r.kind}) ${r.text.replace(/\s+/g, ' ').trim()}`).join('\n')
  );
}

interface QuestionResult {
  id: string;
  expectKind: string;
  pass: boolean;
  missing: string[];
  cited: boolean;
  retrievalHit: boolean;
  topKinds: string[];
  answer: string;
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error('ANTHROPIC_API_KEY is required (set it in apps/api/.env or the environment).');
    process.exit(2);
  }

  const corpus = buildKbEvalCorpus();
  const snapshot = buildKbEvalSnapshot();
  console.log(
    `Meri KB eval: ${KB_EVAL_QUESTIONS.length} questions over a ${corpus.length}-row corpus ` +
      `(model=${MODEL}, top-${TOP_K})...\n`,
  );

  // Embed the whole corpus with the production embedder; fall back to keyword
  // scoring when Bedrock is unreachable (missing AWS creds, no Titan access).
  let scoring: 'titan-cosine' | 'keyword-fallback' = 'titan-cosine';
  const vectors = new Map<string, number[]>();
  try {
    for (const row of corpus) {
      vectors.set(row.id, await embedText(normalize(row.text)));
    }
    console.log(`Embedded ${corpus.length} corpus rows with Titan.\n`);
  } catch (err) {
    console.error(
      `\nembedText failed: ${err instanceof Error ? err.message : String(err)}\n` +
        'Falling back to KEYWORD scoring (matched query terms / terms). Retrieval numbers will\n' +
        'NOT reflect production pgvector quality — run with AWS credentials that can invoke\n' +
        'Bedrock Titan embeddings for the real retrieval@6 signal.\n',
    );
    scoring = 'keyword-fallback';
    vectors.clear();
  }

  async function rankTopK(question: string): Promise<Array<KbCorpusRow & { score: number }>> {
    let scored: Array<KbCorpusRow & { score: number }>;
    if (scoring === 'titan-cosine') {
      const qv = await embedText(normalize(question));
      scored = corpus.map((row) => ({ ...row, score: cosine(qv, vectors.get(row.id) ?? []) }));
    } else {
      scored = corpus.map((row) => ({ ...row, score: keywordScore(question, row.text) }));
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, TOP_K);
  }

  const results: QuestionResult[] = [];
  for (const q of KB_EVAL_QUESTIONS) {
    try {
      const top = await rankTopK(q.question);
      const retrievalHit = top.some((r) => r.kind === q.expectKind);
      const user = `${snapshot}\n\n${renderKbResults(top)}\n\nQuestion: ${q.question}`;
      const answer = await complete(MODEL, SYSTEM_PROMPT, user);
      const lower = answer.toLowerCase();
      const missing = q.mustInclude.filter((s) => !lower.includes(s.toLowerCase()));
      const cited = /\[\d+\]/.test(answer);
      const pass = missing.length === 0 && cited;
      results.push({
        id: q.id,
        expectKind: q.expectKind,
        pass,
        missing,
        cited,
        retrievalHit,
        topKinds: top.map((r) => r.kind),
        answer,
      });
      const detail = pass
        ? ''
        : `  — ${[
            missing.length ? `missing: ${missing.join(', ')}` : null,
            cited ? null : 'no [n] citation',
          ]
            .filter(Boolean)
            .join('; ')}  answer: ${answer.slice(0, 140)}`;
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${q.id}  retrieval@6=${retrievalHit ? 'hit' : 'MISS'}${detail}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        id: q.id,
        expectKind: q.expectKind,
        pass: false,
        missing: q.mustInclude,
        cited: false,
        retrievalHit: false,
        topKinds: [],
        answer: `runner error: ${msg}`,
      });
      console.log(`ERR   ${q.id}  — ${msg}`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const retrievalHits = results.filter((r) => r.retrievalHit).length;
  const passRate = passed / results.length;
  const retrievalAt6 = retrievalHits / results.length;
  const gatePass = passRate >= PASS_GATE;

  const reportUrl = new URL('../test/evals/clio/kb-last-report.json', import.meta.url);
  mkdirSync(dirname(fileURLToPath(reportUrl)), { recursive: true });
  writeFileSync(
    reportUrl,
    JSON.stringify(
      {
        model: MODEL,
        scoring,
        topK: TOP_K,
        corpusRows: corpus.length,
        passRate,
        retrievalAt6,
        gate: { minPassRate: PASS_GATE, pass: gatePass },
        results,
      },
      null,
      2,
    ),
  );

  console.log('\n=== Meri KB eval summary ===');
  console.log(`scoring: ${scoring}`);
  console.log(
    `pass ${passed}/${results.length} (${(passRate * 100).toFixed(1)}%)   ` +
      `retrieval@6 ${retrievalHits}/${results.length} (${(retrievalAt6 * 100).toFixed(1)}%)`,
  );
  console.log(
    gatePass ? '\nGATE: PASS' : `\nGATE: FAIL (need pass-rate >= ${(PASS_GATE * 100).toFixed(0)}%)`,
  );
  process.exit(gatePass ? 0 : 1);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
