/**
 * §21 perf — PE profile budget: p99 < 3000ms.
 *
 *   AUTH_TOKEN=... PE_CODE=0604402F node scripts/perf/pe-profile.perf.js
 *
 * Hits GET /program-elements/:peCode (the PE profile detail). Set PE_CODE to a PE that
 * exists in the target env (default 0604402F). Read-only. Requires autocannon.
 */
const { runScenario, env } = require('./_lib.js');

async function main() {
  const peCode = env('PE_CODE', '0604402F');
  await runScenario({
    title: 'PE profile',
    budgetMs: 3000,
    url: `/program-elements/${encodeURIComponent(peCode)}`,
  });
}

main().catch((e) => {
  console.error('[pe-profile.perf] fatal', e);
  process.exit(1);
});
