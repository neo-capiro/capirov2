/**
 * Clio eval runner (P1-1).  `pnpm --filter @capiro/api eval:clio [--skill=research]`
 *
 * For each committed fixture (src/clio/evals/fixtures.ts) it sends the question +
 * inline sources through the real Clio model (CLIO_MODEL), then runs a cheap
 * grounding verifier (CLIO_INTENT_MODEL) reusing the P0-6 verifier helpers, and
 * grades the answer with the pure grader. Prints per-fixture PASS/FAIL, an
 * aggregate pass-rate + grounded-rate (overall and per skill), writes a JSON
 * report, and exits non-zero if the configured gates are not met.
 *
 * Requires ANTHROPIC_API_KEY + CLIO_MODEL (read from apps/api/.env or the env).
 * This hits the live API and costs tokens, so it is a manual gate, not CI.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIO_EVAL_FIXTURES } from '../src/clio/evals/fixtures.js';
import { clioEvalFixturesSchema } from '../src/clio/evals/eval.types.js';
import type { ClioEvalGrade, ClioEvalSource } from '../src/clio/evals/eval.types.js';
import { gradeAnswer, summarizeGrades } from '../src/clio/evals/eval-grader.js';
import { parseVerifierClaims, summarizeVerification } from '../src/clio/clio-verifier.helpers.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLIO_MODEL;
const INTENT_MODEL = process.env.CLIO_INTENT_MODEL ?? MODEL;
const THRESHOLD = 0.2;
const PASS_GATE = Number(process.env.CLIO_EVAL_MIN_PASS_RATE ?? '0.8');
const GROUNDED_GATE = Number(process.env.CLIO_EVAL_MIN_GROUNDED_RATE ?? '0.8');

interface AnthropicTextBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content?: AnthropicTextBlock[];
}

const SYSTEM_PROMPT = [
  'You are Clio, an AI chief of staff for U.S. federal lobbyists and government-affairs teams.',
  'Answer using ONLY the provided sources. Cite every factual claim inline with [n] matching the source id.',
  'If the sources do not support an answer, say so plainly rather than guessing. Never fabricate sources,',
  'citations, quotes, vote counts, dates, statistics, or guarantees of legislative outcomes.',
  'Refuse and redirect any request that is unethical or illegal — bribery, illegal or concealed campaign',
  'contributions, quid-pro-quo vote-buying, gift-rule or FARA evasion, impersonating constituents, or',
  'fabricating data.',
].join(' ');

function renderSources(sources: ClioEvalSource[]): string {
  if (sources.length === 0) return '(No sources provided.)';
  return 'Sources:\n' + sources.map((s) => `[${s.id}] ${s.title}: ${s.text}`).join('\n');
}

async function callAnthropic(
  model: string,
  system: string,
  user: string,
  maxTokens = 1200,
): Promise<string> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': KEY as string,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as AnthropicResponse;
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
    .trim();
}

/** Returns the unsupported-claim ratio for a sourced answer, or null when not verifiable. */
async function verifyGrounding(answer: string, sources: ClioEvalSource[]): Promise<number | null> {
  if (sources.length === 0) return null;
  const prompt =
    `${renderSources(sources)}\n\nANSWER:\n${answer}\n\n` +
    'Extract the factual claims made in ANSWER. Mark supported=true only when directly supported by ' +
    'the SOURCES above; list the sourceIds used. Return ONLY JSON: ' +
    '{"claims":[{"claim":string,"supported":boolean,"sourceIds":number[]}]}.';
  const out = await callAnthropic(
    INTENT_MODEL as string,
    'You are a strict grounding verifier. Output JSON only.',
    prompt,
    1500,
  );
  const claims = parseVerifierClaims(out);
  if (claims.length === 0) return null;
  return summarizeVerification(claims, THRESHOLD).unsupportedRatio;
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error('ANTHROPIC_API_KEY is required (set it in apps/api/.env or the environment).');
    process.exit(2);
  }
  if (!MODEL) {
    console.error('CLIO_MODEL is required (set it in apps/api/.env or the environment).');
    process.exit(2);
  }

  const skillArg = process.argv.find((a) => a.startsWith('--skill='));
  const only = skillArg ? skillArg.split('=')[1] : undefined;
  let fixtures = clioEvalFixturesSchema.parse(CLIO_EVAL_FIXTURES);
  if (only) fixtures = fixtures.filter((f) => f.skill === only);

  console.log(
    `Running ${fixtures.length} Clio eval fixtures against ${MODEL}${only ? ` (skill=${only})` : ''}...\n`,
  );

  const grades: ClioEvalGrade[] = [];
  for (const f of fixtures) {
    try {
      const user = `${f.question}\n\n${renderSources(f.sources)}`;
      const answer = await callAnthropic(MODEL, SYSTEM_PROMPT, user);
      const ratio = await verifyGrounding(answer, f.sources);
      const grade = gradeAnswer(f, answer, ratio);
      grades.push(grade);
      console.log(
        `${grade.pass ? 'PASS' : 'FAIL'}  [${f.skill}] ${f.id}` +
          (grade.failures.length ? `  — ${grade.failures.join('; ')}` : ''),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      grades.push({
        id: f.id,
        skill: f.skill,
        pass: false,
        failures: [`runner error: ${msg}`],
        citationCount: 0,
        unsupportedRatio: null,
      });
      console.log(`ERR   [${f.skill}] ${f.id}  — ${msg}`);
    }
  }

  const summary = summarizeGrades(grades, THRESHOLD);
  const reportUrl = new URL('../test/evals/clio/last-report.json', import.meta.url);
  mkdirSync(dirname(fileURLToPath(reportUrl)), { recursive: true });
  writeFileSync(reportUrl, JSON.stringify({ generatedFor: MODEL, summary, grades }, null, 2));

  console.log('\n=== Clio eval summary ===');
  console.log(
    `pass ${summary.passed}/${summary.total} (${(summary.passRate * 100).toFixed(1)}%)   ` +
      `grounded ${(summary.groundedRate * 100).toFixed(1)}% of ${summary.verifiedCount} verified`,
  );
  for (const [skill, st] of Object.entries(summary.bySkill)) {
    console.log(`  ${skill.padEnd(10)} ${st.passed}/${st.total}`);
  }
  const gatePass = summary.passRate >= PASS_GATE && summary.groundedRate >= GROUNDED_GATE;
  console.log(
    gatePass
      ? '\nGATE: PASS'
      : `\nGATE: FAIL (need pass>=${(PASS_GATE * 100).toFixed(0)}%, grounded>=${(GROUNDED_GATE * 100).toFixed(0)}%)`,
  );
  process.exit(gatePass ? 0 : 1);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
