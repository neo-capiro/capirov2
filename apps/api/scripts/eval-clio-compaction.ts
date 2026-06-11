/**
 * Compaction needle-retention eval (assistant-parity F2).
 * `pnpm --filter @capiro/api eval:clio:compaction`
 *
 * Replays the synthetic 300-message conversation
 * (src/clio/evals/compaction-fixtures.ts) through the REAL rolling-summary
 * pipeline: the same planCompaction trigger + buildCompactionPrompt with the
 * live small model (CLIO_INTENT_MODEL), exactly as the after-turn job runs in
 * production. At the end, each of the 20 needle probes is asked against
 * [summary block + verbatim 12-message tail] using CLIO_MODEL and graded by
 * substring match.
 *
 * Gates (exit non-zero when unmet):
 *   retention >= CLIO_COMPACTION_EVAL_MIN_RETENTION (default 0.95)
 *   bounded prompt: final prompt sized <= summary + tail (always true by
 *   construction; the script prints the prompt size for the record)
 *   <= 1 small-model call per ~15 turns (asserted from the call count)
 *
 * Requires ANTHROPIC_API_KEY (+ CLIO_MODEL / CLIO_INTENT_MODEL) from
 * apps/api/.env or the environment. Live API, manual gate — not CI.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPACTION_NEEDLES,
  generateCompactionConversation,
} from '../src/clio/evals/compaction-fixtures.js';
import {
  buildCompactionPrompt,
  estimateTokens,
  formatSummaryBlockForPrompt,
  planCompaction,
  sanitizeSummaryOutput,
} from '../src/clio/clio-compaction.helpers.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLIO_MODEL ?? 'claude-sonnet-4-6';
const INTENT_MODEL = process.env.CLIO_INTENT_MODEL ?? 'claude-haiku-4-5-20251001';
const TRIGGER_TOKENS = Number(process.env.CLIO_COMPACTION_TRIGGER_TOKENS ?? '5000');
const TAIL_MESSAGES = Number(process.env.CLIO_COMPACTION_TAIL_MESSAGES ?? '12');
const RETENTION_GATE = Number(process.env.CLIO_COMPACTION_EVAL_MIN_RETENTION ?? '0.95');

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

async function complete(model: string, system: string, user: string, maxTokens = 1200): Promise<string> {
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

async function main(): Promise<void> {
  if (!KEY) {
    console.error('ANTHROPIC_API_KEY is required (set it in apps/api/.env or the environment).');
    process.exit(2);
  }
  const conversation = generateCompactionConversation();
  console.log(
    `Simulating rolling compaction over ${conversation.length} messages ` +
      `(trigger=${TRIGGER_TOKENS} tokens, tail=${TAIL_MESSAGES}, summarizer=${INTENT_MODEL})...\n`,
  );

  // Replay the after-turn job message-by-message, exactly as production runs it.
  let summary: string | null = null;
  let boundary = 0; // count of messages already folded into the summary
  let smallModelCalls = 0;
  for (let upTo = 1; upTo <= conversation.length; upTo += 1) {
    const since = conversation.slice(boundary, upTo);
    const plan = planCompaction({
      messages: since,
      existingSummary: summary,
      triggerTokens: TRIGGER_TOKENS,
      tailMessages: TAIL_MESSAGES,
    });
    if (!plan.compact) continue;
    const prompt = buildCompactionPrompt({
      existingSummary: summary,
      turns: plan.toSummarize.map((m) => ({ role: m.role, body: m.body })),
    });
    const raw = await complete(INTENT_MODEL, prompt.system, prompt.user, 1200);
    const next = sanitizeSummaryOutput(raw);
    if (!next) throw new Error('summarizer returned empty output');
    summary = next;
    boundary += plan.toSummarize.length;
    smallModelCalls += 1;
    console.log(
      `compaction #${smallModelCalls} at message ${upTo}: folded ${plan.toSummarize.length} ` +
        `(summary ~${estimateTokens(summary)} tokens)`,
    );
  }
  if (!summary) throw new Error('conversation never triggered compaction — fixture/trigger mismatch');

  const tail = conversation.slice(boundary);
  const tailText = tail.map((m) => `${m.role === 'assistant' ? 'Clio' : 'User'}: ${m.body}`).join('\n');
  const promptTokens = estimateTokens(summary) + estimateTokens(tailText);
  const turns = conversation.length / 2;
  const callsPer15Turns = smallModelCalls / (turns / 15);
  console.log(
    `\nFinal state: summary ~${estimateTokens(summary)} tokens + ${tail.length}-message tail ` +
      `(~${promptTokens} prompt tokens total). Small-model calls: ${smallModelCalls} ` +
      `(${callsPer15Turns.toFixed(2)} per 15 turns).\n`,
  );

  // Probe retention: ask each needle question against summary + tail only.
  const system =
    'You are Clio, an AI chief of staff for federal lobbyists. Answer from the conversation record provided. Be direct and specific.';
  const record = `${formatSummaryBlockForPrompt(summary)}\n\nMost recent turns:\n${tailText}`;
  let passed = 0;
  const results: Array<{ id: string; pass: boolean; answer: string }> = [];
  for (const needle of COMPACTION_NEEDLES) {
    const answer = await complete(MODEL, system, `${record}\n\nQuestion: ${needle.probe}`, 400);
    const ok = needle.mustInclude.every((s) => answer.toLowerCase().includes(s.toLowerCase()));
    if (ok) passed += 1;
    results.push({ id: needle.id, pass: ok, answer });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${needle.id}${ok ? '' : `  — answer: ${answer.slice(0, 160)}`}`);
  }

  const retention = passed / COMPACTION_NEEDLES.length;
  const reportUrl = new URL('../test/evals/clio/compaction-last-report.json', import.meta.url);
  mkdirSync(dirname(fileURLToPath(reportUrl)), { recursive: true });
  writeFileSync(
    reportUrl,
    JSON.stringify(
      { model: MODEL, intentModel: INTENT_MODEL, smallModelCalls, callsPer15Turns, promptTokens, retention, results, summary },
      null,
      2,
    ),
  );

  console.log(`\n=== Compaction eval summary ===`);
  console.log(`retention ${passed}/${COMPACTION_NEEDLES.length} (${(retention * 100).toFixed(1)}%)`);
  console.log(`small-model calls per 15 turns: ${callsPer15Turns.toFixed(2)} (gate <= 1)`);
  const gatePass = retention >= RETENTION_GATE && callsPer15Turns <= 1;
  console.log(gatePass ? '\nGATE: PASS' : `\nGATE: FAIL (need retention>=${RETENTION_GATE * 100}% and <=1 call/15 turns)`);
  process.exit(gatePass ? 0 : 1);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
