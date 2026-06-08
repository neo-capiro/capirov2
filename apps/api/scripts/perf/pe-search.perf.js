/**
 * §21 perf — PE search budget: p99 < 1000ms.
 *
 *   AUTH_TOKEN=... BASE_URL=http://localhost:3000/api node scripts/perf/pe-search.perf.js
 *
 * Hits GET /program-elements?q=<term> (the PE search list). Set PE_SEARCH_Q to control the
 * query term (default "missile"). Read-only. Requires autocannon (see _lib.js / runbook).
 */
const { runScenario, env } = require('./_lib.js');

async function main() {
  const q = env('PE_SEARCH_Q', 'missile');
  await runScenario({
    title: 'PE search',
    budgetMs: 1000,
    url: `/program-elements?q=${encodeURIComponent(q)}&limit=25`,
  });
}

main().catch((e) => {
  console.error('[pe-search.perf] fatal', e);
  process.exit(1);
});
