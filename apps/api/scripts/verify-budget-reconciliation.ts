/**
 * Step 0.2 — extraction-totals reconciliation harness.
 *
 *   pnpm --filter @capiro/api verify:budget-reconciliation          # check DB vs control totals
 *   pnpm --filter @capiro/api verify:budget-reconciliation -- --json # machine output for CI
 *   pnpm --filter @capiro/api verify:budget-reconciliation -- --seed # regenerate control_totals.json
 *
 * Sums program_element_year by (fiscalYear, field→budgetCycle, component) and compares to the
 * committed control totals (scripts/__data__/control_totals.json). PASS at ≤0.5% relative delta
 * per group; exits 1 on any FAIL. Iteration is DB-driven — groups with no loaded data are not
 * checked, and a DB group with no control total is SKIPped (cannot validate), never FAILed.
 *
 * --seed derives control totals by summing the committed committee artifacts (request→PB,
 * mark→chamber cycle); the R-1 artifact carries no per-line dollars. See the file's _provenance.
 */
import { config as dotenvConfig } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { dollarsToMillions, serviceFromPeCode } from '../src/program-element/jbook/jbook-extract.js';
import {
  checkBudgetReconciliation,
  type ControlGroup,
  type ControlTotals,
  type GroupResult,
  type ReconResult,
} from '../src/program-element/reconciliation/budget-reconciliation.js';

dotenvConfig();

const DATA_DIR = path.resolve('scripts/__data__');
const CONTROL_PATH = path.join(DATA_DIR, 'control_totals.json');

const CHAMBER_MARK: Record<string, { cycle: string; field: string }> = {
  HASC: { cycle: 'hasc', field: 'hascMark' },
  SASC: { cycle: 'sasc', field: 'sascMark' },
  'HAC-D': { cycle: 'hac_d', field: 'hacDMark' },
  'SAC-D': { cycle: 'sac_d', field: 'sacDMark' },
  HACD: { cycle: 'hac_d', field: 'hacDMark' },
  SACD: { cycle: 'sac_d', field: 'sacDMark' },
};

interface CommitteeArtifact {
  chamber?: string;
  fy?: number;
  source?: string;
  rows?: Array<{ peCode: string; fy?: number; request?: number | null; mark?: number | null }>;
}

function seedControlTotals(): ControlTotals {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => /^armed_services_.*\.json$/.test(f))
    .sort();
  const acc = new Map<string, ControlGroup>();
  const add = (fy: number, cycle: string, component: string, field: string, millions: number | null, source: string) => {
    if (millions === null) return;
    const key = `${fy}|${cycle}|${component}|${field}`;
    const cur = acc.get(key) ?? { fiscalYear: fy, budgetCycle: cycle, component, field, totalMillions: 0, source };
    cur.totalMillions += millions;
    acc.set(key, cur);
  };

  // The President's Budget request is ONE figure per (fy, peCode) — every chamber's report
  // restates the same request column, so it must be counted once, not summed across the HASC
  // and SASC files for a year. Marks are chamber-specific (distinct fields) and are not deduped.
  const seenPbPe = new Set<string>();
  const usedFiles: string[] = [];
  for (const f of files) {
    const art = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8')) as CommitteeArtifact;
    const chamber = (art.chamber ?? '').toUpperCase().replace(/[^A-Z-]/g, '');
    const markInfo = CHAMBER_MARK[chamber];
    for (const row of art.rows ?? []) {
      const fy = Number(row.fy ?? art.fy);
      if (!Number.isFinite(fy) || !row.peCode) continue;
      const component = serviceFromPeCode(row.peCode).service ?? 'UNKNOWN';
      const pbKey = `${fy}|${row.peCode}`;
      if (!seenPbPe.has(pbKey)) {
        seenPbPe.add(pbKey);
        add(fy, 'pb', component, 'request', dollarsToMillions(row.request ?? null), `${f}:request`);
      }
      if (markInfo) add(fy, markInfo.cycle, component, markInfo.field, dollarsToMillions(row.mark ?? null), `${f}:mark`);
    }
    usedFiles.push(f);
  }

  const groups = [...acc.values()]
    .map((g) => ({ ...g, totalMillions: Math.round(g.totalMillions * 100) / 100 }))
    .sort(
      (a, b) =>
        a.fiscalYear - b.fiscalYear ||
        a.component.localeCompare(b.component) ||
        a.budgetCycle.localeCompare(b.budgetCycle),
    );

  return {
    _provenance: {
      note:
        "Control totals for extraction validation (Step 0.2). Derived by summing the committed " +
        "committee artifacts' request (→PB) and mark (→chamber cycle) columns, $→millions. The R-1 " +
        'artifact carries no per-line dollars, so PB totals come from the committee request column. ' +
        'Replace/augment with hand-entered R-1 summary-page totals when available. Regenerate via ' +
        '`verify:budget-reconciliation -- --seed`.',
      method: 'summed_from_committee_artifacts',
      tolerancePct: 0.5,
      seededAtDate: new Date().toISOString().slice(0, 10),
      artifacts: usedFiles,
    },
    groups,
  };
}

function printTable(res: ReconResult): void {
  const header = ['FY', 'cycle', 'component', 'field', 'extracted($M)', 'control($M)', 'Δ%', 'status'];
  const rows: string[][] = [
    header,
    ...res.results.map((r: GroupResult) => [
      String(r.fiscalYear),
      r.budgetCycle,
      r.component,
      r.field,
      r.extractedMillions.toFixed(2),
      r.controlMillions === null ? '—' : r.controlMillions.toFixed(2),
      r.deltaPct === null ? '—' : `${(r.deltaPct * 100).toFixed(3)}%`,
      r.status,
    ]),
  ];
  const widths = header.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  console.log('\n=== Budget reconciliation: extracted vs control (PASS ≤0.5%) ===');
  for (const row of rows) console.log('  ' + row.map((c, i) => c.padEnd(widths[i]!)).join('  '));
  console.log(
    `\n${res.ok ? 'PASS' : 'FAIL'}: ${res.passed} passed, ${res.failed} failed, ${res.skipped} skipped (no control).`,
  );
  if (!res.ok) {
    console.log('Failing groups:');
    for (const r of res.results.filter((g) => g.status === 'FAIL')) {
      console.log(`  - FY${r.fiscalYear} ${r.budgetCycle}/${r.component} ${r.field}: extracted ${r.extractedMillions} vs control ${r.controlMillions} (Δ ${r.deltaMillions})`);
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { json: { type: 'boolean' }, seed: { type: 'boolean' }, control: { type: 'string' } },
  });

  if (values.seed) {
    const control = seedControlTotals();
    fs.writeFileSync(CONTROL_PATH, JSON.stringify(control, null, 2) + '\n');
    console.log(
      JSON.stringify(
        { seeded: true, path: path.relative(process.cwd(), CONTROL_PATH), groups: control.groups.length },
        null,
        2,
      ),
    );
    return;
  }

  const controlPath = values.control ? path.resolve(values.control) : CONTROL_PATH;
  if (!fs.existsSync(controlPath)) {
    console.error(`[verify-budget-reconciliation] no control file at ${controlPath}; run with --seed first.`);
    process.exit(1);
  }
  const control = JSON.parse(fs.readFileSync(controlPath, 'utf-8')) as ControlTotals;

  const prisma = new PrismaClient();
  await prisma.$connect();
  try {
    const res = await checkBudgetReconciliation(prisma as never, control);
    if (values.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      printTable(res);
    }
    if (!res.ok) process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error('[verify-budget-reconciliation] fatal', err?.stack || err);
  process.exit(1);
});
