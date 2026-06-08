/**
 * §21 perf — action card generation budget: p99 < 10000ms.
 *
 *   AUTH_TOKEN=... node scripts/perf/action-generate.perf.js
 *
 * Hits POST /intelligence/actions/generate (regenerate cards for the caller's tenant).
 *
 * WARNING: this route WRITES (it generates/refreshes action cards). Unlike the search /
 * profile scenarios it is NOT read-only — run it ONLY against a disposable/seeded perf
 * environment, never production. Low connection count by default to avoid hammering the
 * generator. Requires autocannon.
 */
const { runScenario } = require('./_lib.js');

async function main() {
  // Force a low concurrency for the write path regardless of CONNECTIONS env.
  process.env.CONNECTIONS = process.env.CONNECTIONS || '2';
  process.env.DURATION = process.env.DURATION || '30';
  await runScenario({
    title: 'action card generation (WRITES — seeded env only)',
    budgetMs: 10000,
    url: '/intelligence/actions/generate',
    method: 'POST',
    body: {},
  });
}

main().catch((e) => {
  console.error('[action-generate.perf] fatal', e);
  process.exit(1);
});
