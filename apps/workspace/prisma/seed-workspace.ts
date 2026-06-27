/**
 * Seed the 20 global workspace templates into ws_template (scope GLOBAL,
 * tenantId null). Idempotent: upserts by deterministic id derived from the
 * template's stable string id, so re-running on every deploy keeps the catalog
 * in sync with the seed file in git. (Mirrors apps/api seed-workflows pattern.)
 *
 * Run: pnpm --filter @capiro/workspace seed
 * In Docker: invoked by the migrate verb after `prisma migrate deploy`.
 */
import { PrismaClient } from '../generated/prisma-client/index.js';
import { TEMPLATES } from '../src/templates/templates.data.js';

// Deterministic UUIDv5-style id from the stable slug, so upserts are stable
// across runs without needing a DB lookup. We use a fixed namespace prefix.
import { createHash } from 'node:crypto';
function stableUuid(slug: string): string {
  const h = createHash('sha1').update(`ws-template:${slug}`).digest('hex');
  // Format as a UUID (not a real v5 but deterministic + valid shape).
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    `8${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join('-');
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  let upserted = 0;
  try {
    for (const t of TEMPLATES) {
      const id = stableUuid(t.id);
      await prisma.wsTemplate.upsert({
        where: { id },
        create: {
          id,
          tenantId: null, // GLOBAL
          name: t.name,
          icon: t.icon,
          description: t.desc,
          product: t.product,
          style: t.style,
          fontFamily: t.fontFamily,
          accentColor: t.accentColor,
          meriPrimary: t.meriPrimary,
          meriSecondary: t.meriSecondary,
          elements: t.elements,
          sections: t.sections,
        },
        update: {
          name: t.name,
          icon: t.icon,
          description: t.desc,
          product: t.product,
          style: t.style,
          fontFamily: t.fontFamily,
          accentColor: t.accentColor,
          meriPrimary: t.meriPrimary,
          meriSecondary: t.meriSecondary,
          elements: t.elements,
          sections: t.sections,
        },
      });
      upserted += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`Seeded ${upserted} workspace templates (global).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Template seed failed:', e);
  process.exit(1);
});
