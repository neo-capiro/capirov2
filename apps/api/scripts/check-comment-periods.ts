/**
 * Check for Federal Register comment periods closing within 14 days and emit
 * IntelligenceChange alerts for relevant tenant clients.
 *   npx tsx scripts/check-comment-periods.ts
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenvConfig();

const prisma = new PrismaClient();

const AGENCY_SECTOR_MAP: Record<string, string[]> = {
  'Department of Defense': ['DEFENSE'],
  'DOD': ['DEFENSE'],
  'Environmental Protection Agency': ['ENVIRONMENT_WATER'],
  'EPA': ['ENVIRONMENT_WATER'],
  'Department of Health and Human Services': ['HEALTH'],
  'HHS': ['HEALTH'],
  'Food and Drug Administration': ['HEALTH'],
  'FDA': ['HEALTH'],
  'Department of Energy': ['ENERGY'],
  'DOE': ['ENERGY'],
  'Department of Transportation': ['TRANSPORTATION'],
  'DOT': ['TRANSPORTATION'],
  'Department of Agriculture': ['AGRICULTURE'],
  'USDA': ['AGRICULTURE'],
  'Department of Homeland Security': ['HOMELAND_SECURITY'],
  'DHS': ['HOMELAND_SECURITY'],
  'Department of Commerce': ['COMMERCE_TECH'],
  'Federal Communications Commission': ['COMMERCE_TECH'],
  'FCC': ['COMMERCE_TECH'],
  'Department of Education': ['EDUCATION'],
  'Securities and Exchange Commission': ['FINANCIAL_SERVICES'],
  'SEC': ['FINANCIAL_SERVICES'],
  'Department of the Treasury': ['FINANCIAL_SERVICES'],
  'Consumer Financial Protection Bureau': ['FINANCIAL_SERVICES'],
  'Department of the Interior': ['ENVIRONMENT_WATER'],
  'Army Corps of Engineers': ['ENVIRONMENT_WATER', 'DEFENSE'],
};

interface FrDoc {
  id: string;
  title: string;
  type: string;
  comment_end_date: Date;
  agency_names: string[];
  topics: string[];
}

interface ClientWithCaps {
  id: string;
  name: string;
  sector_tag: string | null;
  capabilities: Array<{ sector: string | null; tags: unknown; name: string }>;
}

async function main() {
  const now = new Date();
  const fourteenDaysOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const startedAt = now;
  console.log(`[check-comment-periods] starting at ${startedAt.toISOString()}`);

  // Get all upcoming docs with comment deadlines
  const docs = await prisma.$queryRaw<FrDoc[]>`
    SELECT id, title, type, comment_end_date, agency_names, topics
    FROM federal_register_document
    WHERE type IN ('PROPOSED_RULE', 'RULE')
      AND comment_end_date > ${now}
      AND comment_end_date <= ${fourteenDaysOut}
    ORDER BY comment_end_date ASC
  `;
  console.log(`[check-comment-periods] ${docs.length} documents with upcoming deadlines`);

  if (!docs.length) {
    console.log('[check-comment-periods] nothing to do');
    return;
  }

  // Get all active tenants
  const tenants = await prisma.$queryRaw<Array<{ id: string; slug: string }>>`
    SELECT id, slug FROM tenants WHERE status = 'active'
  `;

  let emitted = 0;
  let errors = 0;

  for (const tenant of tenants) {
    // Get active clients with capabilities
    const clients = await prisma.$queryRaw<Array<{ id: string; name: string; sector_tag: string | null }>>`
      SELECT id, name, sector_tag FROM clients
      WHERE tenant_id = ${tenant.id}::uuid AND profile_status = 'ACTIVE'
    `;

    const capRows = await prisma.$queryRaw<Array<{ client_id: string; sector: string | null; tags: unknown; name: string }>>`
      SELECT client_id, sector, tags_jsonb AS tags, name FROM client_capabilities
      WHERE tenant_id = ${tenant.id}::uuid
        AND client_id = ANY(${clients.map((c) => c.id)}::uuid[])
    `;

    // Group capabilities by clientId
    const capsByClient = new Map<string, Array<{ sector: string | null; tags: unknown; name: string }>>();
    for (const cap of capRows) {
      if (!capsByClient.has(cap.client_id)) capsByClient.set(cap.client_id, []);
      capsByClient.get(cap.client_id)!.push({ sector: cap.sector, tags: cap.tags, name: cap.name });
    }

    const clientsWithCaps: ClientWithCaps[] = clients.map((c) => ({
      ...c,
      capabilities: capsByClient.get(c.id) ?? [],
    }));

    for (const doc of docs) {
      const daysToDeadline = Math.ceil((new Date(doc.comment_end_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const urgencyMultiplier = daysToDeadline < 3 ? 2.0 : daysToDeadline <= 7 ? 1.5 : 1.0;
      const severity = daysToDeadline < 3 ? 'critical' : daysToDeadline <= 7 ? 'notable' : 'info';
      const agencies = doc.agency_names as string[];

      // Map agencies to sectors
      const docSectors = new Set<string>();
      for (const agency of agencies) {
        for (const sector of (AGENCY_SECTOR_MAP[agency] ?? [])) {
          docSectors.add(sector);
        }
      }

      for (const client of clientsWithCaps) {
        let baseRelevance = 0;

        if (client.sector_tag && docSectors.has(client.sector_tag)) {
          baseRelevance = Math.max(baseRelevance, 0.5);
        }

        for (const cap of client.capabilities) {
          if (cap.sector && docSectors.has(cap.sector)) {
            baseRelevance = Math.max(baseRelevance, 0.5);
          }
        }

        if (baseRelevance < 0.7) {
          const capKeywords = new Set<string>();
          for (const cap of client.capabilities) {
            if (cap.sector) capKeywords.add(cap.sector.toLowerCase());
            if (cap.name) cap.name.split(/\s+/).filter((w) => w.length > 3).forEach((w) => capKeywords.add(w.toLowerCase()));
            const tags = Array.isArray(cap.tags) ? (cap.tags as unknown[]) : [];
            for (const t of tags) {
              if (typeof t === 'string' && t.length > 3) capKeywords.add(t.toLowerCase());
            }
          }

          for (const topic of (doc.topics as string[])) {
            const topicLower = topic.toLowerCase();
            for (const kw of capKeywords) {
              if (topicLower.includes(kw) || kw.includes(topicLower)) {
                baseRelevance = Math.max(baseRelevance, 0.7);
                break;
              }
            }
          }
        }

        const finalScore = baseRelevance * urgencyMultiplier;
        if (finalScore <= 0.3) continue;

        try {
          await prisma.intelligenceChange.create({
            data: {
              source: 'federal_register',
              changeType: 'comment_deadline_approaching',
              severity,
              title: `Comment period closing in ${daysToDeadline}d: ${String(doc.title).slice(0, 80)}`,
              description: `${doc.type} from ${agencies.slice(0, 2).join('/')} has a comment deadline in ${daysToDeadline} days. Relevant to ${client.name} (relevance: ${Math.round(finalScore * 100)}%).`,
              relatedClientIds: [client.id],
              relatedIssues: [],
              data: { documentId: doc.id, daysToDeadline, relevanceScore: finalScore, tenantId: tenant.id },
            },
          });
          emitted++;
        } catch (err) {
          errors++;
          console.error(`[check-comment-periods] failed to emit for ${client.name}/${doc.id}:`, err);
        }
      }
    }

    console.log(`[check-comment-periods] tenant=${tenant.slug} processed`);
  }

  console.log(`[check-comment-periods] done. Emitted ${emitted} alerts, ${errors} errors. Elapsed: ${Date.now() - startedAt.getTime()}ms`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
