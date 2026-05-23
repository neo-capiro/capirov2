/**
 * Refresh the lobby_intel_mv materialized view.
 *
 *   pnpm --filter @capiro/api refresh:lobby-intel
 *
 * Calls refresh_lobby_intel_mv() which runs REFRESH MATERIALIZED VIEW
 * CONCURRENTLY (so reads don't block). Run after sync-lda.ts to pick up
 * new filings; safe to run on cron every ~6h.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenvConfig();

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  try {
    console.log('[refresh-lobby-intel] starting');
    await prisma.$executeRawUnsafe('SELECT refresh_lobby_intel_mv()');
    const rows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      'SELECT COUNT(*)::bigint AS count FROM lobby_intel_mv',
    );
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[refresh-lobby-intel] DONE in ${elapsed}s — ${rows[0]?.count ?? 0} rows in lobby_intel_mv`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[refresh-lobby-intel] FAILED', err);
  process.exit(1);
});
