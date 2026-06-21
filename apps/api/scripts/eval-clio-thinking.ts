/**
 * Extended-thinking pairwise eval (assistant-parity F3).
 * `pnpm --filter @capiro/api eval:clio:thinking`
 *
 * For each deep-tier prompt (src/clio/evals/thinking-fixtures.ts) it produces
 * two answers with CLIO_MODEL — baseline (no thinking param, exactly the old
 * request shape) vs extended thinking (the same thinkingRequestParams the
 * service uses) — then asks a judge model which answer is better for a
 * government-affairs professional, with position randomized per-item
 * (deterministic alternation) to cancel position bias. Latency for both arms
 * is recorded so the p95 overhead criterion is measured, not guessed.
 *
 * Gates (exit non-zero when unmet):
 *   thinking win-rate >= CLIO_THINKING_EVAL_MIN_WINRATE (default 0.6; ties
 *   count as half a win)
 *
 * Requires ANTHROPIC_API_KEY. Live API, manual gate — not CI.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THINKING_EVAL_PROMPTS } from '../src/meri/evals/thinking-fixtures.js';
import { thinkingRequestParams } from '../src/meri/meri-thinking.helpers.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLIO_MODEL ?? 'claude-sonnet-4-6';
const JUDGE_MODEL = process.env.CLIO_EVAL_JUDGE_MODEL ?? MODEL;
const WINRATE_GATE = Number(process.env.CLIO_THINKING_EVAL_MIN_WINRATE ?? '0.6');
const MAX_TOKENS = Number(process.env.CLIO_MAX_TOKENS ?? '4000');
const BUDGET = Number(process.env.CLIO_THINKING_BUDGET_TOKENS ?? '8000');
const MODE = (process.env.CLIO_THINKING_MODE ?? 'adaptive') as 'adaptive' | 'budget';

const SYSTEM =
  'You are Meri, an elite AI chief of staff for government affairs professionals. ' +
  'Structure outputs for rapid scanning before high-stakes meetings. Be specific and actionable.';

interface ArmResult {
  text: string;
  latencyMs: number;
}

async function answer(prompt: string, withThinking: boolean): Promise<ArmResult> {
  const params = withThinking
    ? thinkingRequestParams({ enabled: true, mode: MODE, budgetTokens: BUDGET }, 'deep', MAX_TOKENS)
    : { thinking: null, maxTokens: MAX_TOKENS };
  const started = Date.now();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': KEY as string,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: params.maxTokens,
      ...(params.thinking ? { thinking: params.thinking } : {}),
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
    .trim();
  return { text, latencyMs: Date.now() - started };
}

async function judge(prompt: string, a: string, b: string): Promise<'A' | 'B' | 'TIE'> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': KEY as string,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 10,
      system:
        'You judge two answers for a senior government-affairs professional. Criteria: strategic depth, ' +
        'correctness of process knowledge, specificity, actionability, and structure. Reply with exactly ' +
        'one token: A, B, or TIE.',
      messages: [
        {
          role: 'user',
          content: `TASK:\n${prompt}\n\n=== ANSWER A ===\n${a}\n\n=== ANSWER B ===\n${b}\n\nWhich answer is better? Reply A, B, or TIE.`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const out = (data.content ?? [])
    .filter((blk) => blk.type === 'text')
    .map((blk) => blk.text ?? '')
    .join('')
    .trim()
    .toUpperCase();
  if (out.startsWith('A')) return 'A';
  if (out.startsWith('B')) return 'B';
  return 'TIE';
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] as number;
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error('ANTHROPIC_API_KEY is required (set it in apps/api/.env or the environment).');
    process.exit(2);
  }
  console.log(
    `Pairwise eval: ${THINKING_EVAL_PROMPTS.length} deep-tier prompts on ${MODEL} ` +
      `(thinking mode=${MODE}), judge=${JUDGE_MODEL}\n`,
  );

  let wins = 0;
  let ties = 0;
  const baselineLatencies: number[] = [];
  const thinkingLatencies: number[] = [];
  const rows: Array<{ id: string; verdict: string; baselineMs: number; thinkingMs: number }> = [];

  for (let i = 0; i < THINKING_EVAL_PROMPTS.length; i += 1) {
    const fixture = THINKING_EVAL_PROMPTS[i]!;
    try {
      const [baseline, thinking] = await Promise.all([
        answer(fixture.prompt, false),
        answer(fixture.prompt, true),
      ]);
      baselineLatencies.push(baseline.latencyMs);
      thinkingLatencies.push(thinking.latencyMs);
      // Alternate which arm is shown as "A" to cancel position bias.
      const thinkingIsA = i % 2 === 0;
      const verdict = await judge(
        fixture.prompt,
        thinkingIsA ? thinking.text : baseline.text,
        thinkingIsA ? baseline.text : thinking.text,
      );
      const thinkingWon =
        (verdict === 'A' && thinkingIsA) || (verdict === 'B' && !thinkingIsA);
      if (verdict === 'TIE') ties += 1;
      else if (thinkingWon) wins += 1;
      rows.push({
        id: fixture.id,
        verdict: verdict === 'TIE' ? 'tie' : thinkingWon ? 'thinking' : 'baseline',
        baselineMs: baseline.latencyMs,
        thinkingMs: thinking.latencyMs,
      });
      console.log(
        `${fixture.id.padEnd(20)} ${rows[rows.length - 1]!.verdict.padEnd(9)} ` +
          `baseline ${baseline.latencyMs}ms / thinking ${thinking.latencyMs}ms`,
      );
    } catch (err) {
      rows.push({ id: fixture.id, verdict: 'error', baselineMs: 0, thinkingMs: 0 });
      console.log(`${fixture.id.padEnd(20)} ERROR — ${err instanceof Error ? err.message : err}`);
    }
  }

  const judged = rows.filter((r) => r.verdict !== 'error').length;
  const winRate = judged ? (wins + ties / 2) / judged : 0;
  const p95Baseline = percentile(baselineLatencies, 95);
  const p95Thinking = percentile(thinkingLatencies, 95);
  const latencyIncrease = p95Baseline > 0 ? (p95Thinking - p95Baseline) / p95Baseline : 0;

  const reportUrl = new URL('../test/evals/clio/thinking-last-report.json', import.meta.url);
  mkdirSync(dirname(fileURLToPath(reportUrl)), { recursive: true });
  writeFileSync(
    reportUrl,
    JSON.stringify(
      { model: MODEL, mode: MODE, winRate, wins, ties, judged, p95Baseline, p95Thinking, latencyIncrease, rows },
      null,
      2,
    ),
  );

  console.log('\n=== Thinking pairwise summary ===');
  console.log(`win-rate (ties=half): ${(winRate * 100).toFixed(1)}% over ${judged} prompts (${wins} wins, ${ties} ties)`);
  console.log(
    `p95 latency: baseline ${p95Baseline}ms -> thinking ${p95Thinking}ms ` +
      `(${(latencyIncrease * 100).toFixed(1)}% increase; criterion <= 35%)`,
  );
  const gatePass = winRate >= WINRATE_GATE;
  console.log(gatePass ? '\nGATE: PASS' : `\nGATE: FAIL (need win-rate >= ${WINRATE_GATE * 100}%)`);
  process.exit(gatePass ? 0 : 1);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
