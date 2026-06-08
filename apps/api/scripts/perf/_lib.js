/**
 * Step 4.1 — shared helpers for the §21 perf scripts.
 *
 * These scripts are plain JS (run with `node`) and require `autocannon` at runtime.
 * autocannon is NOT a repo dependency by default — install it where you run the perf
 * pass:  `pnpm add -D autocannon`  (or `npx autocannon ...`). See
 * docs/runbooks/perf-baselines.md.
 *
 * Env:
 *   BASE_URL    base API url, e.g. https://staging.capiro.ai/api  (default http://localhost:3000/api)
 *   AUTH_TOKEN  bearer token for an authenticated standard_user in the target tenant
 *   DURATION    seconds per run (default 20)
 *   CONNECTIONS concurrent connections (default 10)
 */

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function loadAutocannon() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    return require('autocannon');
  } catch {
    console.error(
      'autocannon is not installed. Install it before running the perf pass:\n' +
        '  pnpm add -D autocannon   (or: npx autocannon ...)\n' +
        'See docs/runbooks/perf-baselines.md.',
    );
    process.exit(2);
  }
}

function baseConfig() {
  const baseUrl = env('BASE_URL', 'http://localhost:3000/api');
  const token = env('AUTH_TOKEN', '');
  if (!token) {
    console.warn(
      'WARNING: AUTH_TOKEN is empty — authenticated routes will 401 and the latency numbers ' +
        'will be meaningless. Set AUTH_TOKEN to a standard_user bearer token.',
    );
  }
  return {
    baseUrl,
    headers: {
      authorization: token ? `Bearer ${token}` : '',
      'content-type': 'application/json',
    },
    duration: Number(env('DURATION', '20')),
    connections: Number(env('CONNECTIONS', '10')),
  };
}

/**
 * Run one autocannon scenario and print the p50/p90/p99 latency + a pass/fail against the
 * §21 budget (in ms). Returns the result object.
 */
async function runScenario({ title, budgetMs, url, method = 'GET', body }) {
  const autocannon = loadAutocannon();
  const cfg = baseConfig();
  console.log(`\n=== ${title} ===`);
  console.log(`target: ${cfg.baseUrl}${url}  (budget p99 < ${budgetMs}ms, §21)`);

  const result = await autocannon({
    url: `${cfg.baseUrl}${url}`,
    method,
    headers: cfg.headers,
    body: body ? JSON.stringify(body) : undefined,
    duration: cfg.duration,
    connections: cfg.connections,
  });

  const p50 = result.latency.p50;
  const p90 = result.latency.p90;
  const p99 = result.latency.p99;
  const pass = p99 < budgetMs;
  console.log(
    `latency ms: p50=${p50} p90=${p90} p99=${p99}  ` +
      `req/s mean=${result.requests.mean}  non2xx=${result.non2xx}`,
  );
  console.log(`§21 budget p99<${budgetMs}ms → ${pass ? 'PASS' : 'FAIL'}`);
  return result;
}

module.exports = { env, baseConfig, runScenario };
