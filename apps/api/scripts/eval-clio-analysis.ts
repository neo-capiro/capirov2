/**
 * Analysis eval for the run_analysis sandbox tool (assistant-parity F4).
 * `pnpm --filter @capiro/api eval:clio:analysis`
 *
 * For each of the 15 fixture cases (src/clio/evals/analysis-fixtures.ts):
 *   1. Ask CLIO_MODEL to WRITE PYTHON for the question, given the dataset
 *      schema (column names + 2 sample rows). Datasets land at
 *      ./data/<name>.csv inside the sandbox.
 *   2. Execute the code through the REAL sandbox runner (runSandboxed from
 *      apps/clio-sandbox — same harness/limits as the deployed service;
 *      SANDBOX_PYTHON is respected automatically by run.ts).
 *   3. Ask CLIO_MODEL to answer the question from the sandbox stdout/results.
 *   4. Grade: every groundTruth.mustInclude substring must appear in the
 *      final answer (commas stripped from both sides, case-insensitive, so
 *      "270,000" == "270000").
 *
 * Also records per-case sandbox durationMs and reports p50/p95 execution
 * latency in the summary.
 *
 * Gate (exit non-zero when unmet):
 *   pass rate >= CLIO_ANALYSIS_EVAL_MIN_PASS (default 0.9)
 *
 * Requires ANTHROPIC_API_KEY (+ CLIO_MODEL) from apps/api/.env or the
 * environment, plus a local python with pandas for the sandbox harness.
 * Live API, manual gate — not CI.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANALYSIS_EVAL_CASES, type AnalysisEvalCase } from '../src/meri/evals/analysis-fixtures.js';
import { runSandboxed, type SandboxRunResult } from '../../meri-sandbox/src/run.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLIO_MODEL ?? 'claude-sonnet-4-6';
const MIN_PASS = Number(process.env.CLIO_ANALYSIS_EVAL_MIN_PASS ?? '0.9');

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

async function complete(model: string, system: string, user: string, maxTokens = 1500): Promise<string> {
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

/**
 * Extract python from a model reply robustly: prefer fenced ```python blocks
 * (joined, in case the model split the script), fall back to the raw reply.
 */
function extractPython(reply: string): string {
  const fenced = [...reply.matchAll(/```(?:python|py)?[ \t]*\r?\n([\s\S]*?)```/gi)]
    .map((m) => (m[1] ?? '').trim())
    .filter(Boolean);
  if (fenced.length) return fenced.join('\n\n');
  return reply.trim();
}

const CODEGEN_SYSTEM = [
  'You write Python for a locked-down analysis sandbox.',
  'Rules:',
  '- Reply with PYTHON CODE ONLY (one ```python block or raw code). No prose, no explanations.',
  '- The input datasets are CSV files at ./data/<name>.csv. pandas and the csv module are available.',
  '- No network access. Read only from ./data. Charts (optional) go to ./out/*.png.',
  '- print() your findings clearly and label them, using FULL unabbreviated numbers',
  '  (e.g. 270000 or 270,000 — never 0.27M or "$0.27 million").',
].join('\n');

const ANSWER_SYSTEM = [
  'You are Meri, an AI chief of staff for federal lobbyists.',
  'Answer the question using ONLY the sandbox analysis output provided.',
  'Be direct and specific. Always write FULL unabbreviated numbers',
  '(e.g. 4000000 or 4,000,000 — never 4M or "4.0 million").',
].join(' ');

function describeDatasets(evalCase: AnalysisEvalCase): string {
  return evalCase.datasets
    .map((d) => {
      const columns = Object.keys(d.rows[0] ?? {});
      const samples = d.rows.slice(0, 2).map((r) => JSON.stringify(r));
      return [
        `Dataset ./data/${d.name}.csv (${d.rows.length} rows)`,
        `  Columns: ${columns.join(', ')}`,
        `  Sample rows: ${samples.join('  |  ')}`,
      ].join('\n');
    })
    .join('\n\n');
}

/** Comma-insensitive, case-insensitive normalization shared by both sides. */
function normalizeForMatch(s: string): string {
  return s.replace(/,/g, '').toLowerCase();
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

interface CaseResult {
  id: string;
  pass: boolean;
  missing: string[];
  sandbox: {
    ok: boolean;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
  } | null;
  answer: string;
  error: string | null;
}

async function runCase(evalCase: AnalysisEvalCase): Promise<CaseResult> {
  // 1) Code generation.
  const codegenUser = [
    `Question to answer with code: ${evalCase.question}`,
    '',
    describeDatasets(evalCase),
    '',
    'Write the python now.',
  ].join('\n');
  const reply = await complete(MODEL, CODEGEN_SYSTEM, codegenUser, 1500);
  const code = extractPython(reply);
  if (!code) throw new Error('model returned no python code');

  // 2) Sandbox execution against the real runner (writes ./data/<name>.csv from rows).
  const sandbox: SandboxRunResult = await runSandboxed({
    code,
    datasets: evalCase.datasets.map((d) => ({ name: d.name, rows: d.rows })),
  });

  // 3) Final answer from the sandbox output.
  const answerUser = [
    `Question: ${evalCase.question}`,
    '',
    `Sandbox exit: ok=${sandbox.ok} exitCode=${sandbox.exitCode} timedOut=${sandbox.timedOut}`,
    '',
    'Sandbox stdout:',
    sandbox.stdout || '(empty)',
    '',
    'Sandbox results.json:',
    sandbox.results != null ? JSON.stringify(sandbox.results) : '(none)',
    ...(sandbox.stderr ? ['', 'Sandbox stderr:', sandbox.stderr.slice(0, 2000)] : []),
  ].join('\n');
  const answer = await complete(MODEL, ANSWER_SYSTEM, answerUser, 600);

  // 4) Grade: all mustInclude fragments present (comma/case-insensitive).
  const normalizedAnswer = normalizeForMatch(answer);
  const missing = evalCase.groundTruth.mustInclude.filter(
    (fragment) => !normalizedAnswer.includes(normalizeForMatch(fragment)),
  );

  return {
    id: evalCase.id,
    pass: missing.length === 0,
    missing,
    sandbox: {
      ok: sandbox.ok,
      exitCode: sandbox.exitCode,
      timedOut: sandbox.timedOut,
      durationMs: sandbox.durationMs,
    },
    answer,
    error: null,
  };
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error('ANTHROPIC_API_KEY is required (set it in apps/api/.env or the environment).');
    process.exit(2);
  }

  console.log(`Running analysis eval: ${ANALYSIS_EVAL_CASES.length} cases (model=${MODEL})...\n`);

  const results: CaseResult[] = [];
  for (const evalCase of ANALYSIS_EVAL_CASES) {
    let result: CaseResult;
    try {
      result = await runCase(evalCase);
    } catch (err) {
      result = {
        id: evalCase.id,
        pass: false,
        missing: [...evalCase.groundTruth.mustInclude],
        sandbox: null,
        answer: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    results.push(result);
    const latency = result.sandbox ? `${result.sandbox.durationMs}ms` : 'n/a';
    console.log(
      `${result.pass ? 'PASS' : 'FAIL'}  ${result.id}  (sandbox ${latency})` +
        (result.pass
          ? ''
          : `  — missing: [${result.missing.join(', ')}]` +
            (result.error ? `  error: ${result.error.slice(0, 160)}` : '')),
    );
  }

  const passed = results.filter((r) => r.pass).length;
  const passRate = passed / results.length;
  const durations = results
    .map((r) => r.sandbox?.durationMs)
    .filter((d): d is number => typeof d === 'number');
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);

  const reportUrl = new URL('../test/evals/clio/analysis-last-report.json', import.meta.url);
  mkdirSync(dirname(fileURLToPath(reportUrl)), { recursive: true });
  writeFileSync(
    reportUrl,
    JSON.stringify(
      {
        model: MODEL,
        minPass: MIN_PASS,
        passed,
        total: results.length,
        passRate,
        sandboxLatency: { p50Ms: p50, p95Ms: p95, samples: durations.length },
        results,
      },
      null,
      2,
    ),
  );

  console.log('\n=== Analysis eval summary ===');
  console.log(`pass rate ${passed}/${results.length} (${(passRate * 100).toFixed(1)}%)`);
  console.log(`sandbox execution latency: p50 ${p50}ms, p95 ${p95}ms (${durations.length} runs)`);
  const gatePass = passRate >= MIN_PASS;
  console.log(gatePass ? '\nGATE: PASS' : `\nGATE: FAIL (need pass rate >= ${MIN_PASS * 100}%)`);
  process.exit(gatePass ? 0 : 1);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
