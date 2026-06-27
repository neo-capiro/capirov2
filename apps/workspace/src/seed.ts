/**
 * Compiled template seed — runnable from the runtime image (dist/seed.js),
 * unlike prisma/seed-workspace.ts which needs tsx + src paths. Invoked by the
 * container `seed` verb. Idempotent upsert of the 20 global templates.
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '../generated/prisma-client/index.js';
import { TEMPLATES } from './templates/templates.data.js';

function stableUuid(slug: string): string {
  const h = createHash('sha1').update(`ws-template:${slug}`).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), `5${h.slice(13, 16)}`, `8${h.slice(17, 20)}`, h.slice(20, 32)].join('-');
}

export async function seedTemplates(): Promise<number> {
  const prisma = new PrismaClient();
  let upserted = 0;
  try {
    for (const t of TEMPLATES) {
      const id = stableUuid(t.id);
      const data = {
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
      };
      await prisma.wsTemplate.upsert({
        where: { id },
        create: { id, tenantId: null, ...data },
        update: data,
      });
      upserted += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`Seeded ${upserted} workspace templates (global).`);
    return upserted;
  } finally {
    await prisma.$disconnect();
  }
}

// Run when invoked directly (node dist/seed.js).
seedTemplates().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Template seed failed:', e);
  process.exit(1);
});
