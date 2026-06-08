/**
 * Read-only TENANT/CLIENT CONFIG EXPORT. Dumps everything a tenant (and its
 * clients) has configured — a record snapshot. Resolves the search term against
 * BOTH tenant (name/slug) and client (name), so it works whether the term names
 * a firm or a client.
 *
 *   diag-tenant-config "c2 strategies"
 *
 * SAFE: SELECT-only. No writes. Prints tagged JSON sections to stdout/CloudWatch.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const num = (_k: string, v: unknown) => (typeof v === 'bigint' ? Number(v) : v);

async function q<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql, ...params);
}

const CHILD_TABLES = [
  'client_capabilities',
  'client_people',
  'client_facilities',
  'client_intel_mapping',
  'client_association_overrides',
  'client_submission_history',
];

async function main(): Promise<void> {
  const term = (process.argv.slice(2).join(' ') || 'c2 strategies').trim();
  const like = `%${term}%`;
  const likeNoSpace = `%${term.replace(/\s+/g, '')}%`;

  // 1) Tenants matching name or slug.
  const tenants = await q(
    `SELECT * FROM tenants WHERE name ILIKE $1 OR slug ILIKE $1 OR slug ILIKE $2 ORDER BY created_at`,
    like,
    likeNoSpace,
  );
  const tenantIds = tenants.map((t) => String((t as { id: string }).id));
  console.log('TC_TENANTS ' + JSON.stringify({ term, matched: tenants.length, tenants }, num, 2));

  // 2) Clients: belonging to a matched tenant OR whose own name matches the term.
  const clients = await q(
    `SELECT * FROM clients
      WHERE (tenant_id::text = ANY($1::text[])) OR name ILIKE $2
      ORDER BY created_at`,
    tenantIds,
    like,
  );
  const clientIds = clients.map((c) => String((c as { id: string }).id));
  console.log('TC_CLIENTS_SUMMARY ' + JSON.stringify({ matched: clients.length, names: clients.map((c) => (c as { name: string }).name) }, num, 2));

  // 3) For each client, dump the full profile + all attached config rows.
  for (const c of clients) {
    const id = String((c as { id: string }).id);
    const block: Record<string, unknown> = { client: c };
    for (const t of CHILD_TABLES) {
      try {
        block[t] = await q(`SELECT * FROM ${t} WHERE client_id::text = $1`, id);
      } catch (e) {
        block[t] = `ERR:${e instanceof Error ? e.message.slice(0, 120) : 'x'}`;
      }
    }
    console.log(`TC_CLIENT ${(c as { name: string }).name} ` + JSON.stringify(block, num, 2));
  }

  console.log('TC_DONE ' + JSON.stringify({ tenants: tenants.length, clients: clients.length }, num, 2));
}

main()
  .catch((err) => {
    console.error('TC_ERR', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
