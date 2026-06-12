/**
 * DEMO CLIENT SEEDER. Creates (or refreshes) ONE fully-populated demo client
 * under a tenant — default the Capiro internal tenant — so every product
 * surface has production-grade data to show:
 *
 *   - Client profile: overview (gov IDs, intake, sector, tracks), capabilities
 *     (with PE numbers + submission history), people, facilities
 *   - Engagement Manager: contacts, past + upcoming meetings (encrypted note +
 *     debrief, approved meeting prep), tasks, outreach record, mail thread,
 *     draft campaign with recipients
 *   - Strategies: one FY27 strategy with member/staffer targets
 *   - Workflows: one NDAA-track instance
 *   - Intelligence: confirmed LDA mapping (real filings), tracked bills (real
 *     bills resolved at run time), client brief, Clio notes/alert, action
 *     recommendations
 *   - Program Element watch: seeds the 0603270A fixture (record + FY2023-27
 *     marks + milestones, source='fixture' so real J-book data always wins),
 *     names the demo client as an R-3 performer, adds proof-pack citations,
 *     and watches the PE as the resolved user.
 *
 * Tenant-scoped writes run inside a single RLS-bypass transaction (mirrors
 * PrismaService.withSystem, with a longer timeout). PE tables are global (no
 * RLS) and written via the standard ProgramElementWriterService so source
 * priority / reconciliation behave exactly like production ingestion.
 *
 * Idempotent: keyed on (tenant, client name). Re-running wipes and recreates
 * the demo client's child rows; the client id is preserved.
 *
 * DRY RUN by default — prints the resolution plan. Pass --commit to write.
 *
 *   seed-demo-client --commit
 *   seed-demo-client --commit --tenant capiro --user neo@capiro.ai
 *   seed-demo-client --commit --client-name "Aperture Defense Systems" \
 *     --lda-client-id 12345 --pe 0603270A
 */
import { config as dotenvConfig } from 'dotenv';
import { createCipheriv, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ProgramElementWriterService } from '../src/program-element/program-element-writer.service.js';
import { PROGRAM_ELEMENT_FIXTURES } from '../src/program-element/program-element-fixture-data.js';
import { normalizeName } from '../src/acquisition-personnel/normalization/name-normalizer.js';

dotenvConfig();

// ── args ────────────────────────────────────────────────────────────────────
function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}
const COMMIT = process.argv.includes('--commit');
const TENANT_TERM = argValue('--tenant') ?? 'capiro';
const USER_EMAIL = argValue('--user') ?? 'neo@capiro.ai';
const CLIENT_NAME = argValue('--client-name') ?? 'Aperture Defense Systems';
const PE_CODE = argValue('--pe') ?? '0603270A';
const LDA_OVERRIDE = argValue('--lda-client-id');

const log = (tag: string, payload: unknown) =>
  // eslint-disable-next-line no-console
  console.log(`${tag} ${JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2)}`);

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

// ── encrypted note bodies (mirrors MeetingNotesCryptoService) ───────────────
function encryptNoteBody(plainText: string): { bodyCiphertext: string; iv: string; authTag: string; keyVersion: string } | null {
  const rawKey = process.env.NOTES_ENCRYPTION_KEY?.trim();
  if (!rawKey) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(rawKey) ? Buffer.from(rawKey, 'hex') : Buffer.from(rawKey, 'base64');
  if (key.length !== 32) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return {
    bodyCiphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: process.env.NOTES_ENCRYPTION_KEY_VERSION ?? 'v1',
  };
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.onModuleInit();

  try {
    // ── resolve tenant + user (RLS-protected) ──────────────────────────────
    const { tenant, user } = await prisma.withSystem(async (tx) => {
      const tenants = await tx.tenant.findMany({
        where: {
          OR: [
            { slug: { contains: TENANT_TERM, mode: 'insensitive' } },
            { name: { contains: TENANT_TERM, mode: 'insensitive' } },
          ],
        },
        select: { id: true, slug: true, name: true, status: true },
      });
      if (tenants.length !== 1) {
        log('SEED_TENANT_AMBIGUOUS', { term: TENANT_TERM, matches: tenants });
        throw new Error(`Expected exactly 1 tenant for "${TENANT_TERM}", got ${tenants.length}`);
      }
      const t = tenants[0]!;
      const u = await tx.user.findFirst({
        where: { email: USER_EMAIL },
        select: { id: true, email: true, memberships: { where: { tenantId: t.id }, select: { role: true, status: true } } },
      });
      if (!u) throw new Error(`User ${USER_EMAIL} not found`);
      if (u.memberships.length === 0) {
        log('SEED_WARN', { note: `${USER_EMAIL} has no membership in tenant ${t.slug}; proceeding anyway` });
      }
      return { tenant: t, user: u };
    });

    // ── resolve real reference data (global tables, no RLS) ────────────────
    const ndaaBills = await prisma.congressBill.findMany({
      where: { congress: 119, title: { contains: 'National Defense Authorization', mode: 'insensitive' } },
      orderBy: { latestActionDate: { sort: 'desc', nulls: 'last' } },
      take: 1,
      select: { id: true, title: true },
    });
    const defenseBills = await prisma.congressBill.findMany({
      where: {
        congress: 119,
        policyArea: 'Armed Forces and National Security',
        id: { notIn: ndaaBills.map((b) => b.id) },
        // skip commemorative vehicles — pick substantive, active bills
        NOT: [{ title: { contains: 'Gold Medal', mode: 'insensitive' } }, { title: { contains: 'commemorat', mode: 'insensitive' } }],
      },
      orderBy: [{ cosponsorsCount: 'desc' }, { latestActionDate: { sort: 'desc', nulls: 'last' } }],
      take: 2,
      select: { id: true, title: true },
    });
    const trackedBills = [...ndaaBills, ...defenseBills].slice(0, 3);

    let ldaCandidatePreview: Array<{ id: number; name: string; totalSpending: unknown; score: number }> = [];
    const ldaClient = LDA_OVERRIDE
      ? await prisma.ldaClient.findUnique({ where: { id: Number(LDA_OVERRIDE) } })
      : await (async () => {
          // demo client is a defense-tech company — rank candidates so the mapped
          // lobbying history looks plausible: prefer literal defense names over
          // generic tech brands, mid-tier spend over Fortune-50 totals, and skip
          // advocacy nonprofits ("Natural Resources Defense Council").
          const candidates = await prisma.ldaClient.findMany({
            where: {
              issueCodes: { has: 'DEF' },
              latestFilingYear: { gte: 2024 },
              totalSpending: { gte: 1_000_000, lte: 50_000_000 },
              OR: ['DEFENSE', 'AEROSPACE', 'DYNAMICS', 'SYSTEMS', 'TECHNOLOG', 'SPACE'].map((k) => ({
                name: { contains: k, mode: 'insensitive' as const },
              })),
            },
            orderBy: { totalSpending: 'desc' },
            take: 40,
          });
          const NONPROFIT_RE =
            /\b(COUNCIL|FUND|FOUNDATION|ASSOCIATION|COALITION|INSTITUTE|SOCIETY|ALLIANCE|CENTER|CENTRE|COMMITTEE|LEAGUE|UNIVERSITY|NETWORK|PARTNERSHIP)\b/;
          const score = (c: (typeof candidates)[number]): number => {
            const name = c.name.toUpperCase();
            let s = 0;
            if (NONPROFIT_RE.test(name)) s -= 200;
            if (name.includes('DEFENSE') || name.includes('DEFENCE')) s += 100;
            else if (name.includes('AEROSPACE') || name.includes('DYNAMICS')) s += 60;
            else if (name.includes('SYSTEMS') || name.includes('SPACE')) s += 40;
            if (/\b(INC|CORP|CORPORATION|LLC|CO|LTD|TECHNOLOGIES|INDUSTRIES)\b/.test(name)) s += 20;
            const spend = Number(c.totalSpending ?? 0);
            if (spend >= 2_000_000 && spend <= 15_000_000) s += 25;
            if (name.length <= 40) s += 5;
            return s;
          };
          const ranked = candidates
            .map((c) => ({ c, s: score(c) }))
            .sort((a, b) => b.s - a.s);
          ldaCandidatePreview = ranked
            .slice(0, 10)
            .map(({ c, s }) => ({ id: c.id, name: c.name, totalSpending: c.totalSpending, score: s }));
          return ranked[0]?.c ?? null;
        })();

    const workflowTemplate =
      (await prisma.workflowTemplate.findFirst({
        where: { isActive: true, OR: [{ slug: { contains: 'ndaa' } }, { name: { contains: 'NDAA', mode: 'insensitive' } }] },
        orderBy: { sortOrder: 'asc' },
      })) ??
      (await prisma.workflowTemplate.findFirst({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }));

    const peFixture = PROGRAM_ELEMENT_FIXTURES.find((f) => f.record.peCode === PE_CODE);
    if (!peFixture) throw new Error(`No PE fixture for ${PE_CODE}; available: ${PROGRAM_ELEMENT_FIXTURES.map((f) => f.record.peCode).join(', ')}`);

    log('SEED_PLAN', {
      commit: COMMIT,
      tenant,
      user: { id: user.id, email: user.email },
      clientName: CLIENT_NAME,
      pe: { code: PE_CODE, title: peFixture.record.title },
      ldaClient: ldaClient ? { id: ldaClient.id, name: ldaClient.name, totalSpending: ldaClient.totalSpending } : null,
      ldaCandidates: ldaCandidatePreview,
      trackedBills,
      workflowTemplate: workflowTemplate ? { id: workflowTemplate.id, slug: workflowTemplate.slug } : null,
      notesEncryption: Boolean(process.env.NOTES_ENCRYPTION_KEY),
    });
    if (!COMMIT) {
      log('SEED_DONE', { note: 'dry run — pass --commit to write' });
      return;
    }

    // ── global PE fixture: record + FY history + milestones ────────────────
    const writer = new ProgramElementWriterService(prisma, undefined);
    await writer.upsertProgramElement(peFixture.record, 'fixture', 0.99);
    for (const year of peFixture.years) await writer.upsertProgramElementYear(year, 'fixture');
    for (const milestone of peFixture.milestones) await writer.upsertProgramElementMilestone(milestone, 'fixture');

    // R-3 performer row naming the demo client as a prime (Contractors panel).
    const performerNormalized = CLIENT_NAME.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const performerKey = {
      peCode: PE_CODE,
      performerNormalized,
      location: 'AL',
      contractMethod: 'C/CPFF',
      costCategory: 'Payload Integration & Test',
      fy: 2026,
    };
    const existingPerformer = await prisma.programElementPerformer.findFirst({ where: performerKey });
    if (!existingPerformer) {
      await prisma.programElementPerformer.create({
        data: {
          ...performerKey,
          performer: `${CLIENT_NAME.toUpperCase()} INC`,
          totalCostM: 12.5,
          tableType: 'product_development',
          sourceUrl: peFixture.record.rDocUrl ?? 'https://example.mil/demo',
          pageNumber: 412,
          publisher: 'DoD Comptroller (Army)',
          isNamedCompany: true,
          source: 'fixture',
          confidence: 0.99,
        },
      });
    }

    // Proof-pack citations (Sources panel).
    const sourceRows = [
      { docType: 'R', exhibitType: 'R-2', fy: 2027, pageNumber: 410, snippet: 'Project EW-4: payload integration and developmental test for podded electromagnetic attack payloads; supports Terrestrial Layer EW Suite increment 2.' },
      { docType: 'R', exhibitType: 'R-1', fy: 2027, pageNumber: 38, snippet: 'PE 0603270A, Electronic Warfare Advanced Payloads — FY2027 request $278.5M.' },
    ];
    for (const row of sourceRows) {
      const sourceUrl = peFixture.record.rDocUrl ?? 'https://example.mil/demo';
      const existing = await prisma.programElementSource.findFirst({
        where: { peCode: PE_CODE, docType: row.docType, sourceUrl, pageNumber: row.pageNumber },
      });
      if (!existing) {
        await prisma.programElementSource.create({
          data: { peCode: PE_CODE, sourceUrl, publisher: 'DoD Comptroller (Army)', confidence: 0.99, metadata: { fixture: true }, ...row },
        });
      }
    }
    const enrichment = await seedPeEnrichment(prisma, trackedBills);
    await writer.refreshProgramElementDetailMaterializedView('fixture');

    // ── tenant-scoped demo client (single RLS-bypass transaction) ──────────
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        return seedClient(tx, { tenantId: tenant.id, userId: user.id, ldaClient, trackedBills, workflowTemplateId: workflowTemplate?.id ?? null });
      },
      { timeout: 180_000 },
    );

    // PE watch for the demo user (outside the client tx; has its own unique key).
    await prisma.programElementWatch.upsert({
      where: { userId_peCode: { userId: user.id, peCode: PE_CODE } },
      create: { userId: user.id, tenantId: tenant.id, peCode: PE_CODE },
      update: {},
    });

    log('SEED_DONE', { ...result, peCode: PE_CODE, peEnrichment: enrichment, url: `/clients/${result.clientId}` });
  } finally {
    await prisma.onModuleDestroy();
  }
}

/**
 * Fill the remaining PE-detail panels for the demo PE so PE Watch demos
 * complete: Projects (R-2A), Secondary Distribution (procurement lines),
 * Programs (PE→Program graph), What Changed (deltas), Congressional Activity
 * (bill peCodes tags), Procurement Activity (SAM notices), Program Team
 * (acquisition personnel). All rows are global reference data, marked
 * fixture/demo in source/metadata, created idempotently by natural key.
 *
 * NOTE: extract-bill-pe-codes REPLACES congress_bill.pe_codes from bill text,
 * so the bill tags here may be wiped by its next scheduled run — re-running
 * this seeder restores them (do it shortly before a demo).
 */
async function seedPeEnrichment(
  prisma: PrismaService,
  trackedBills: Array<{ id: string; title: string }>,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const rDocUrl = `https://example.mil/army/rdoc/${PE_CODE}`;

  // ── Projects (R-2A sub-projects) ─────────────────────────────────────────
  const projects = [
    {
      projectCode: 'EW-1',
      title: 'Advanced Techniques & Waveform Development',
      mission:
        'Develops software-defined electromagnetic attack techniques and waveform libraries for podded payloads; transitions matured techniques to Project EW-4 for integration.',
      pageNumber: 408,
    },
    {
      projectCode: 'EW-4',
      title: 'Payload Integration & Test',
      mission:
        'Integrates electromagnetic attack payloads on Group 4/5 UAS and rotary-wing platforms and executes developmental/operational test; supports Terrestrial Layer EW Suite increment 2.',
      pageNumber: 410,
    },
    {
      projectCode: 'EW-7',
      title: 'ML Mission Data Pipeline',
      mission:
        'Stands up a government-owned machine-learning pipeline for rapid EW mission-data reprogramming; reduces reprogramming cycle from weeks to hours.',
      pageNumber: 414,
    },
  ];
  for (const p of projects) {
    await prisma.programElementProject.upsert({
      where: { peCode_projectCode: { peCode: PE_CODE, projectCode: p.projectCode } },
      create: {
        peCode: PE_CODE,
        projectCode: p.projectCode,
        title: p.title,
        mission: p.mission,
        budgetActivity: '04',
        fy: 2027,
        sourceUrl: rDocUrl,
        pageNumber: p.pageNumber,
        source: 'fixture',
        confidence: 0.95,
        metadata: { fixture: true },
      },
      update: { title: p.title, mission: p.mission },
    });
  }
  counts.projects = projects.length;

  // ── Secondary Distribution (per-recipient procurement lines, $M) ─────────
  const procurementLines = [
    { lineDescription: '1st Multi-Domain Task Force (JBLM)', fy: 2026, quantity: 12, dollars: 9.6, unitCost: 0.8 },
    { lineDescription: '1st Multi-Domain Task Force (JBLM)', fy: 2027, quantity: 18, dollars: 13.5, unitCost: 0.75 },
    { lineDescription: '11th Airborne EW Company (JBER)', fy: 2027, quantity: 8, dollars: 6.4, unitCost: 0.8 },
  ];
  for (const line of procurementLines) {
    await prisma.programElementProcurementLine.upsert({
      where: {
        peCode_lineDescription_fy: { peCode: PE_CODE, lineDescription: line.lineDescription, fy: line.fy },
      },
      create: { peCode: PE_CODE, ...line, source: 'fixture', sourceUrl: rDocUrl, raw: { fixture: true } },
      update: { quantity: line.quantity, dollars: line.dollars, unitCost: line.unitCost },
    });
  }
  counts.procurementLines = procurementLines.length;

  // ── Programs (PE→Program graph: one accepted, one candidate) ─────────────
  const programDefs = [
    {
      canonicalName: 'Terrestrial Layer EW Suite',
      status: 'accepted',
      score: 0.94,
      evidenceTier: 'tier1',
      matchBasis: 'Program of record named in R-2 narrative (Project EW-4)',
    },
    {
      canonicalName: 'Multi-Function EW - Air Large',
      status: 'candidate',
      score: 0.61,
      evidenceTier: 'tier3',
      matchBasis: 'Capability-area overlap: airborne electromagnetic attack',
    },
  ];
  for (const def of programDefs) {
    const program =
      (await prisma.program.findFirst({ where: { canonicalName: def.canonicalName } })) ??
      (await prisma.program.create({
        data: {
          canonicalName: def.canonicalName,
          component: 'ARMY',
          capabilityArea: 'Electronic Warfare',
          status: 'active',
          metadata: { fixture: true },
        },
      }));
    const existingMatch = await prisma.peProgramMatch.findFirst({
      where: { peCode: PE_CODE, programId: program.id },
    });
    if (!existingMatch) {
      await prisma.peProgramMatch.create({
        data: {
          peCode: PE_CODE,
          programId: program.id,
          score: def.score,
          evidenceTier: def.evidenceTier,
          evidence: [{ kind: 'fixture', note: def.matchBasis }],
          status: def.status,
          matchBasis: def.matchBasis,
        },
      });
    }
  }
  counts.programs = programDefs.length;

  // ── What Changed (typed budget deltas; live rows, modest materiality) ────
  const deltas = [
    {
      assertedFy: 2027,
      deltaType: 'mark_vs_request',
      fromRef: 'pb_fy2027_request',
      toRef: 'hasc_fy2027_mark',
      amountFrom: 278.5,
      amountTo: 290.0,
      explanation:
        'HASC FY27 mark adds $11.5M above the budget request for accelerated payload integration and developmental test (Project EW-4).',
      materialityScore: 0.58,
    },
    {
      assertedFy: 2026,
      deltaType: 'mark_vs_request',
      fromRef: 'pb_fy2026_request',
      toRef: 'sasc_fy2026_mark',
      amountFrom: 262.0,
      amountTo: 244.0,
      explanation: 'SASC FY26 mark trims $18.0M citing across-the-board RDT&E reduction pressure.',
      materialityScore: 0.44,
    },
    {
      assertedFy: 2027,
      deltaType: 'pb_vs_prior_pb',
      fromRef: 'pb_fy2026',
      toRef: 'pb_fy2027',
      amountFrom: 262.0,
      amountTo: 278.5,
      explanation: 'FY27 request grows $16.5M (+6.3%) over the prior PB, reflecting the increment 2 integration ramp.',
      materialityScore: 0.36,
    },
  ];
  for (const d of deltas) {
    const existing = await prisma.programElementDelta.findFirst({
      where: { peCode: PE_CODE, assertedFy: d.assertedFy, deltaType: d.deltaType, fromRef: d.fromRef, toRef: d.toRef },
    });
    if (!existing) {
      await prisma.programElementDelta.create({
        data: {
          peCode: PE_CODE,
          ...d,
          deltaAbs: Math.round((d.amountTo - d.amountFrom) * 100) / 100,
          deltaPct: Math.round(((d.amountTo - d.amountFrom) / d.amountFrom) * 1000) / 10,
          evidence: { fixture: true, sourceUrl: rDocUrl },
          materialityFactors: { fixture: true },
        },
      });
    }
  }
  counts.deltas = deltas.length;

  // ── Congressional Activity: tag the tracked bills with this PE code ──────
  // (extract-bill-pe-codes may overwrite on its next run; re-seed restores.)
  let billsTagged = 0;
  for (const bill of trackedBills.slice(0, 2)) {
    const row = await prisma.congressBill.findUnique({ where: { id: bill.id }, select: { peCodes: true } });
    if (row && !row.peCodes.includes(PE_CODE)) {
      await prisma.congressBill.update({ where: { id: bill.id }, data: { peCodes: [...row.peCodes, PE_CODE] } });
    }
    if (row) billsTagged += 1;
  }
  counts.billsTagged = billsTagged;

  // ── Procurement Activity (SAM notices + accepted PE matches) ─────────────
  const tlsProgram = await prisma.program.findFirst({ where: { canonicalName: 'Terrestrial Layer EW Suite' } });
  const opportunities = [
    {
      noticeId: 'APRDEMO-W909MY26R0042',
      solicitationNumber: 'W909MY-26-R-0042',
      title: 'Airborne Electromagnetic Attack Payload - Production Readiness Sources Sought',
      noticeType: 'Sources Sought',
      office: 'ACC-APG (CECOM)',
      pscCode: '5865',
      postedDate: daysFromNow(-9),
      responseDeadline: daysFromNow(18),
      description:
        'The Army Contracting Command - Aberdeen Proving Ground is conducting market research for production-ready podded electromagnetic attack payloads supporting PE 0603270A Project EW-4. Responses due 30 days from posting.',
      programId: null as string | null,
    },
    {
      noticeId: 'APRDEMO-W56KGU27R0007',
      solicitationNumber: 'W56KGU-27-R-0007',
      title: 'Terrestrial Layer EW Suite - Payload Integration & Test Support',
      noticeType: 'Presolicitation',
      office: 'ACC-APG (PEO IEW&S)',
      pscCode: 'AC13',
      postedDate: daysFromNow(-3),
      responseDeadline: daysFromNow(35),
      description:
        'Presolicitation for engineering services supporting payload integration and developmental test under the Terrestrial Layer EW Suite program (PE 0603270A).',
      programId: tlsProgram?.id ?? null,
    },
  ];
  for (const opp of opportunities) {
    const { programId, ...oppData } = opp;
    const record = await prisma.samOpportunity.upsert({
      where: { noticeId: opp.noticeId },
      create: {
        ...oppData,
        agency: 'Department of the Army',
        naicsCode: '334511',
        pocName: 'Lisa Grant',
        pocEmail: 'lisa.grant.demo@army.example.mil',
        sourceUrl: `https://sam.gov/opp/${opp.noticeId}`,
        active: true,
        raw: { fixture: true },
      },
      update: { responseDeadline: opp.responseDeadline, active: true },
    });
    const existingMatch = await prisma.samOpportunityMatch.findFirst({
      where: { opportunityId: record.id, peCode: PE_CODE },
    });
    if (!existingMatch) {
      await prisma.samOpportunityMatch.create({
        data: { opportunityId: record.id, peCode: PE_CODE, programId, matchBasis: 'pe_reference', confidence: 0.9, reviewStatus: 'accepted' },
      });
    }
  }
  counts.samOpportunities = opportunities.length;

  // ── Program Team (fictional acquisition personnel, fixture-marked) ───────
  const personnel = [
    {
      fullName: 'Dr. Elaine Marsh',
      title: 'Product Lead, EW Payloads',
      organization: 'PEO IEW&S',
      role: 'Product Lead',
      confidence: 0.92,
      pePrimary: PE_CODE,
      peSecondary: [] as string[],
    },
    {
      fullName: 'COL Marcus Reyes',
      title: 'Product Manager, Electronic Warfare & Cyber',
      organization: 'PEO IEW&S',
      role: 'Product Manager',
      confidence: 0.9,
      pePrimary: PE_CODE,
      peSecondary: [] as string[],
    },
    {
      fullName: 'Sandra Okafor',
      title: 'Deputy Capability Manager, Terrestrial EW',
      organization: 'Army Futures Command',
      role: 'Deputy Capability Manager',
      confidence: 0.86,
      pePrimary: null as string | null,
      peSecondary: [PE_CODE],
    },
  ];
  for (const person of personnel) {
    const nameKey = normalizeName(person.fullName).nameKey;
    const existing = await prisma.acquisitionPersonnel.findFirst({ where: { nameKey } });
    if (!existing) {
      const created = await prisma.acquisitionPersonnel.create({
        data: {
          fullName: person.fullName,
          nameKey,
          service: 'A',
          organization: person.organization,
          title: person.title,
          role: person.role,
          programOfRecord: 'Terrestrial Layer EW Suite',
          pePrimary: person.pePrimary,
          peSecondary: person.peSecondary,
          confidence: person.confidence,
          status: 'active',
          metadata: { fixture: true, demo: true },
        },
      });
      await prisma.acquisitionPersonnelSource.create({
        data: {
          personId: created.id,
          source: 'fixture',
          sourceUrl: rDocUrl,
          snippet: `${person.fullName} — ${person.title}, ${person.organization} (demo fixture).`,
          observedAt: new Date(),
          confidence: 0.9,
          metadata: { fixture: true },
        },
      });
    }
  }
  counts.personnel = personnel.length;

  return counts;
}

interface SeedRefs {
  tenantId: string;
  userId: string;
  ldaClient: { id: number; name: string } | null;
  trackedBills: Array<{ id: string; title: string }>;
  workflowTemplateId: string | null;
}

async function seedClient(tx: Prisma.TransactionClient, refs: SeedRefs): Promise<{ clientId: string; refreshed: boolean }> {
  const { tenantId, userId } = refs;
  const domain = 'aperturedefensesystems.com';

  // ── upsert the client shell (id is stable across re-runs) ────────────────
  const existing = await tx.client.findFirst({ where: { tenantId, name: CLIENT_NAME }, select: { id: true } });
  const clientData = {
    tenantId,
    name: CLIENT_NAME,
    website: `https://www.${domain}`,
    description:
      'Huntsville-based electronic warfare and RF systems company. Designs podded EW payloads, distributed RF sensing arrays, and ML-driven EW mission data tooling for Army and Joint programs. Active OTA prototype work with Army RCCTO and PEO IEW&S; pursuing FY27 RDT&E plus-up and CDS submissions.',
    productDescription:
      'Raptor-X podded electromagnetic attack payload (TRL 7), SpectraNet distributed RF sensing mesh (TRL 6), and the Forge ML EW mission-data reprogramming suite (TRL 5).',
    primaryContactName: 'Dana Whitfield',
    primaryContactEmail: `dwhitfield@${domain}`,
    primaryContactPhone: '(256) 555-0143',
    status: 'active',
    sectorTag: 'DEFENSE',
    profileType: 'CLIENT',
    profileStatus: 'ACTIVE',
    submissionTracks: ['NDAA', 'APPROPRIATIONS', 'CDS'],
    issueCodes: ['DEF', 'AER', 'HOM', 'SCI'],
    uei: 'APRTRDF5QK77',
    cageCode: '7APD3',
    naicsCodes: ['334511', '541715', '334220'],
    pscCodes: ['AC13', '5865'],
    ldaClientIds: refs.ldaClient ? [refs.ldaClient.id] : [],
    createdByUserId: userId,
    intakeData: {
      demo: true,
      sectors: ['DEFENSE', 'COMMERCE_TECH'],
      dba: 'Aperture Defense',
      ein: '47-5550143',
      address1: '4801 Bradford Drive NW',
      city: 'Huntsville',
      state: 'AL',
      zip: '35805',
      country: 'US',
      pocName: 'Dana Whitfield',
      pocTitle: 'Chief Executive Officer',
      pocEmail: `dwhitfield@${domain}`,
      pocPhone: '(256) 555-0143',
      headName: 'Dana Whitfield',
      headTitle: 'Chief Executive Officer',
      uei: 'APRTRDF5QK77',
      cageCode: '7APD3',
      primaryNaics: '334511',
      additionalNaics: '541715, 334220',
      samStatus: 'Active',
      samExpirationDate: '2027-02-18',
      sbClassification: { sb: true, wosb: false, sdvosb: false, hubzone: false, eightA: false, large: false, foreignOwned: false },
      existingContracts: 'Army RCCTO OTA (W31P4Q-25-9-0031); Phase III SBIR with PEO IEW&S; AFWERX STRATFI (sub to prime)',
      engagementStartDate: '2025-09-15',
      requestType: 'RDT&E plus-up',
      fundingAsk: '$12.0M FY27',
      peNumber: PE_CODE,
      internalNotes: 'Flagship demo account. High-touch: monthly program reviews, FY27 NDAA + approps cycle, CDS backup path via AL delegation.',
    },
  };

  let clientId: string;
  if (existing) {
    clientId = existing.id;
    await tx.client.update({ where: { id: clientId }, data: clientData });
    // wipe child rows (FK-safe order); the client id itself is preserved
    await tx.clientSubmissionHistory.deleteMany({ where: { tenantId, clientId } });
    await tx.strategyTarget.deleteMany({ where: { tenantId, strategy: { clientId } } });
    await tx.workflowInstance.deleteMany({ where: { tenantId, clientId } });
    await tx.strategy.deleteMany({ where: { tenantId, clientId } });
    await tx.clientCapability.deleteMany({ where: { tenantId, clientId } });
    await tx.engagementCampaign.deleteMany({ where: { tenantId, clientId } });
    await tx.engagementTask.deleteMany({ where: { tenantId, clientId } });
    await tx.meeting.deleteMany({ where: { tenantId, clientId } });
    await tx.mailThread.deleteMany({ where: { tenantId, clientId } });
    await tx.outreachRecord.deleteMany({ where: { tenantId, clientId } });
    await tx.engagementContact.deleteMany({ where: { tenantId, clientId } });
    await tx.clioNote.deleteMany({ where: { tenantId, clientId } });
    await tx.clioProactiveAlert.deleteMany({ where: { tenantId, clientId } });
    await tx.actionRecommendation.deleteMany({ where: { tenantId, clientId } });
    await tx.trackedBill.deleteMany({ where: { tenantId, clientId } });
    await tx.clientBrief.deleteMany({ where: { tenantId, clientId } });
    await tx.clientIntelMapping.deleteMany({ where: { tenantId, clientId } });
    await tx.clientPerson.deleteMany({ where: { tenantId, clientId } });
    await tx.clientFacility.deleteMany({ where: { tenantId, clientId } });
  } else {
    const created = await tx.client.create({ data: clientData, select: { id: true } });
    clientId = created.id;
  }

  // ── capabilities + submission history ────────────────────────────────────
  const capRaptor = await tx.clientCapability.create({
    data: {
      tenantId,
      clientId,
      name: 'Raptor-X Podded EW Payload',
      type: 'product',
      description:
        'Externally-carried electromagnetic attack payload for Group 4/5 UAS and rotary-wing platforms. Open-architecture (CMOSS/SOSA aligned), software-defined techniques, field-reprogrammable mission data.',
      sector: 'DEFENSE',
      tags: ['electronic warfare', 'CMOSS', 'open architecture', 'airborne'],
      issueCodes: ['DEF'],
      trl: 7,
      mrl: 6,
      peNumber: PE_CODE,
      peNumbers: [PE_CODE],
      keywords: ['electronic warfare', 'electromagnetic attack', 'EW payload', 'jamming', 'spectrum dominance', 'CMOSS', 'SOSA'],
      appropriationAccount: 'RDT&E, Army (2040)',
      serviceBranch: 'Army',
      targetSubcommittee: 'HAC-D',
      fundingAsk: 12_000_000,
      fundingAskLabel: '$12.0M FY27 RDT&E plus-up',
      justification:
        'Accelerates payload integration and developmental test under PE 0603270A Project EW-4, closing the documented Army gap in airborne electromagnetic attack capacity ahead of the FY28 Terrestrial Layer EW Suite increment 2 decision.',
      districtNexus: 'AL-05 (Huntsville): 184 employees, $31M annual payroll; Austin TX-37 radar lab: 52 employees.',
      existingContracts: 'Army RCCTO OTA prototype; Phase III SBIR with PEO IEW&S',
      notes: 'Lead capability for the FY27 cycle. Flight-test report from Yuma available under NDA.',
      sortOrder: 0,
    },
  });
  const capSpectra = await tx.clientCapability.create({
    data: {
      tenantId,
      clientId,
      name: 'SpectraNet Distributed RF Sensing',
      type: 'platform',
      description: 'Networked passive RF sensing mesh for emitter geolocation and spectrum situational awareness at the tactical edge.',
      sector: 'DEFENSE',
      tags: ['passive RF', 'geolocation', 'mesh networking'],
      issueCodes: ['DEF', 'HOM'],
      trl: 6,
      mrl: 5,
      peNumbers: [PE_CODE],
      keywords: ['RF sensing', 'signals intelligence', 'emitter geolocation', 'spectrum awareness', 'passive detection'],
      serviceBranch: 'Army',
      targetSubcommittee: 'SAC-D',
      fundingAsk: 6_500_000,
      fundingAskLabel: '$6.5M FY27 CDS',
      justification: 'Fields a persistent passive RF sensing picket for border and installation defense missions; dual-use with CBP requirements.',
      districtNexus: 'AL-05 (Huntsville) manufacturing and integration.',
      notes: 'CDS-eligible; AL delegation briefed March 2026.',
      sortOrder: 1,
    },
  });
  await tx.clientCapability.create({
    data: {
      tenantId,
      clientId,
      name: 'Forge ML EW Mission Data Suite',
      type: 'technology',
      description: 'Machine-learning toolchain that compresses EW mission-data reprogramming from weeks to hours; deployed in a government-owned enclave.',
      sector: 'DEFENSE',
      tags: ['machine learning', 'mission data', 'reprogramming'],
      issueCodes: ['DEF', 'SCI'],
      trl: 5,
      mrl: 4,
      peNumbers: [PE_CODE],
      keywords: ['machine learning', 'EW reprogramming', 'mission data files', 'cognitive EW', 'artificial intelligence'],
      serviceBranch: 'Army',
      targetSubcommittee: 'HASC',
      fundingAsk: 4_000_000,
      fundingAskLabel: '$4.0M FY27 authorization language',
      justification: 'Supports NDAA language directing rapid EW reprogramming pilot within PEO IEW&S.',
      notes: 'Pair with Raptor-X in member meetings — same PE, complementary story.',
      sortOrder: 2,
    },
  });
  await tx.clientSubmissionHistory.createMany({
    data: [
      {
        tenantId, clientId, capabilityId: capRaptor.id, fiscalYear: '2025',
        title: 'FY25 NDAA RDT&E plus-up — EW payload prototyping',
        meta: 'NDAA / HASC', outcome: '$8.0M secured in conference (PE 0603270A)', outcomeType: 'success',
        notes: 'Member-supported plus-up survived conference; executed via RCCTO OTA.',
      },
      {
        tenantId, clientId, capabilityId: capSpectra.id, fiscalYear: '2026',
        title: 'FY26 CDS — distributed RF sensing picket',
        meta: 'CDS / SAC-D', outcome: '$3.2M of $6.0M request funded', outcomeType: 'partial',
        notes: 'Funded at reduced level; remainder rolled into FY27 ask.',
      },
      {
        tenantId, clientId, capabilityId: capRaptor.id, fiscalYear: '2027',
        title: 'FY27 RDT&E plus-up — payload integration & test',
        meta: 'Appropriations / HAC-D', outcome: null, outcomeType: 'in_progress',
        notes: 'Submitted via member offices March 2026; tracking subcommittee mark.',
      },
    ],
  });

  // ── people + facilities ──────────────────────────────────────────────────
  await tx.clientPerson.createMany({
    data: [
      { tenantId, clientId, name: 'Dana Whitfield', title: 'Chief Executive Officer', email: `dwhitfield@${domain}`, phone: '(256) 555-0143', role: 'executive', lastContact: daysFromNow(-6), notes: 'Prefers fortnightly syncs; decision-maker on all Hill asks.' },
      { tenantId, clientId, name: 'Marcus Bell', title: 'VP, Government Relations', email: `mbell@${domain}`, phone: '(256) 555-0177', role: 'gov_relations', lastContact: daysFromNow(-2), notes: 'Day-to-day contact. Ex-SASC PSM; strong AL delegation relationships.' },
      { tenantId, clientId, name: 'Dr. Priya Raman', title: 'Chief Technology Officer', email: `praman@${domain}`, phone: '(512) 555-0822', role: 'technical_lead', lastContact: daysFromNow(-20), notes: 'Lead for technical briefings and classified annex content.' },
    ],
  });
  await tx.clientFacility.createMany({
    data: [
      { tenantId, clientId, name: 'Huntsville HQ & Integration Center', addressLine: '4801 Bradford Drive NW', city: 'Huntsville', state: 'AL', zip: '35805', congressionalDistrict: '05', districtSource: 'manual', employeeCount: 184, notes: 'HQ, payload integration line, secure lab (up to TS).' },
      { tenantId, clientId, name: 'Austin Radar & RF Lab', addressLine: '7600 Metropolis Drive', city: 'Austin', state: 'TX', zip: '78744', congressionalDistrict: '37', districtSource: 'manual', employeeCount: 52, notes: 'Anechoic chamber, RF test range partnership with UT Austin.' },
    ],
  });

  // ── strategy + targets ───────────────────────────────────────────────────
  const strategy = await tx.strategy.create({
    data: {
      tenantId,
      clientId,
      capabilityId: capRaptor.id,
      createdByUserId: userId,
      name: 'FY27 EW Payload — Authorization & Appropriations',
      fiscalYear: '2027',
      status: 'active',
      description:
        'Dual-track: NDAA authorization language via HASC (AL-05) plus a $12.0M HAC-D plus-up. CDS backup via AL delegation if subcommittee allocation tightens. Anchor on district nexus (Huntsville jobs) and the FY25 conference win.',
      submissionTypes: ['NDAA', 'APPROPRIATIONS', 'CDS'],
      settings: { primaryTrack: 'APPROPRIATIONS', backupTrack: 'CDS', peCode: PE_CODE, ask: 12_000_000 },
    },
  });
  await tx.strategyTarget.createMany({
    data: [
      { tenantId, strategyId: strategy.id, memberName: 'Rep. Dale Strong', memberTitle: 'Representative (AL-05)', memberParty: 'R', memberState: 'AL', committee: 'House Armed Services', subcommittee: 'Cyber, Information Technologies, and Innovation', stafferName: 'Katherine Doyle', stafferEmail: 'katherine.doyle@mail.house.gov', outreachStatus: 'meeting_scheduled', meetingDate: daysFromNow(12), notes: 'District member — Huntsville HQ. Carries the NDAA language request.' },
      { tenantId, strategyId: strategy.id, memberName: 'Sen. Katie Britt', memberTitle: 'Senator (AL)', memberParty: 'R', memberState: 'AL', committee: 'Senate Appropriations', subcommittee: 'Defense (SAC-D)', stafferName: 'Robert Hayes', stafferEmail: 'robert_hayes@britt.senate.gov', outreachStatus: 'in_progress', notes: 'SAC-D seat; CDS backup path. Staff briefed on SpectraNet March 2026.' },
      { tenantId, strategyId: strategy.id, memberName: 'Rep. Ken Calvert', memberTitle: 'Representative (CA-41), Chair HAC-D', memberParty: 'R', memberState: 'CA', committee: 'House Appropriations', subcommittee: 'Defense (HAC-D)', stafferName: 'Anne Marie Chong', stafferEmail: 'annemarie.chong@mail.house.gov', outreachStatus: 'not_started', notes: 'Primary approps target for the $12.0M plus-up. Request one-pager v3 in review.' },
    ],
  });

  // ── workflow instance ────────────────────────────────────────────────────
  if (refs.workflowTemplateId) {
    await tx.workflowInstance.create({
      data: {
        tenantId,
        templateId: refs.workflowTemplateId,
        createdByUserId: userId,
        clientId,
        strategyId: strategy.id,
        title: 'FY27 NDAA Member Request — Raptor-X EW Payload (AL-05)',
        status: 'in_progress',
        submissionDeadline: daysFromNow(25),
        submissionMethod: 'Member office portal',
        notes: 'Language draft v2 with Strong office; technical annex cleared by client 6/3.',
        formData: { peCode: PE_CODE, ask: '$12.0M', account: 'RDT&E, Army (2040)', sponsor: 'Rep. Dale Strong (AL-05)' },
      },
    });
  }

  // ── campaign + recipients ────────────────────────────────────────────────
  const campaign = await tx.engagementCampaign.create({
    data: {
      tenantId,
      clientId,
      createdByUserId: userId,
      name: 'FY27 Approps — EW Payload Plus-Up (HAC-D)',
      type: 'custom',
      status: 'draft',
      subject: 'FY27 Defense Appropriations request — PE 0603270A payload integration ($12.0M)',
      body:
        'Dear {{first_name}},\n\nOn behalf of Aperture Defense Systems (Huntsville, AL), we respectfully request the Subcommittee include a $12.0M increase to PE 0603270A (Electronic Warfare Advanced Payloads), Project EW-4, in the FY27 Defense Appropriations bill.\n\nThe increase accelerates payload integration and developmental test for the Raptor-X podded electromagnetic attack payload — capability the Army Electronic Warfare cross-functional team has identified as a near-term gap. The work sustains 184 engineering jobs in Huntsville, AL, with flight test at Yuma Proving Ground.\n\nAperture delivered its FY25 plus-up on schedule and under cost via Army RCCTO. A one-page justification and the program office endorsement letter are attached.\n\nRespectfully,\nMarcus Bell\nVP Government Relations, Aperture Defense Systems',
      sourceContext: { strategyId: strategy.id, peCode: PE_CODE },
      metadata: { demo: true },
    },
  });
  await tx.engagementCampaignRecipient.createMany({
    data: [
      { tenantId, campaignId: campaign.id, name: 'Anne Marie Chong', email: 'annemarie.chong@mail.house.gov', title: 'Professional Staff Member', office: 'House Appropriations — Defense Subcommittee', status: 'pending' },
      { tenantId, campaignId: campaign.id, name: 'Katherine Doyle', email: 'katherine.doyle@mail.house.gov', title: 'Legislative Director', office: 'Rep. Dale Strong (AL-05)', status: 'pending' },
      { tenantId, campaignId: campaign.id, name: 'Robert Hayes', email: 'robert_hayes@britt.senate.gov', title: 'Defense Appropriations Staffer', office: 'Sen. Katie Britt (AL)', status: 'pending' },
    ],
  });

  // ── engagement: contacts, meetings, tasks, outreach, mail ────────────────
  const contactDoyle = await tx.engagementContact.create({
    data: { tenantId, clientId, fullName: 'Katherine Doyle', email: 'katherine.doyle@mail.house.gov', phone: '(202) 555-0190', organization: 'Office of Rep. Dale Strong (AL-05)', title: 'Legislative Director', source: 'manual' },
  });
  const contactRccto = await tx.engagementContact.create({
    data: { tenantId, clientId, fullName: 'COL (R) James Patton', email: 'james.patton.demo@army.example.mil', phone: '(256) 555-0011', organization: 'Army RCCTO', title: 'Program Integrator, EW Portfolio', source: 'manual' },
  });

  const pastMeeting = await tx.meeting.create({
    data: {
      tenantId, clientId, source: 'manual', subject: 'Quarterly program review — Raptor-X OTA status & FY27 strategy',
      description: 'Review RCCTO OTA milestones, Yuma flight-test results, and align on the FY27 plus-up narrative ahead of Hill day.',
      location: 'Aperture Huntsville HQ / Teams', startsAt: daysFromNow(-15), endsAt: new Date(daysFromNow(-15).getTime() + 60 * 60_000),
      organizerEmail: USER_EMAIL, organizerName: 'Capiro', status: 'completed', createdByUserId: userId, metadata: { demo: true },
    },
  });
  await tx.meetingAttendee.createMany({
    data: [
      { tenantId, meetingId: pastMeeting.id, email: `mbell@${domain}`, name: 'Marcus Bell', role: 'client', responseStatus: 'accepted' },
      { tenantId, meetingId: pastMeeting.id, email: `praman@${domain}`, name: 'Dr. Priya Raman', role: 'client', responseStatus: 'accepted' },
      { tenantId, meetingId: pastMeeting.id, email: USER_EMAIL, name: 'Capiro', role: 'organizer', responseStatus: 'accepted' },
    ],
  });
  const noteEnc = encryptNoteBody(
    'Yuma flight test: 9 of 10 technique objectives met; one waveform deferred to Q3 software drop. RCCTO PI satisfied with schedule. Client confirmed $12.0M FY27 ask is firm — split $9.5M integration / $2.5M test. Priya to deliver unclass one-pager v3 by 6/10. Risk: HAC-D allocation pressure; CDS backup via Britt office stays warm.',
  );
  if (noteEnc) {
    await tx.meetingNote.create({ data: { tenantId, meetingId: pastMeeting.id, clientId, authorUserId: userId, ...noteEnc } });
  }
  const debriefEnc = encryptNoteBody(
    'Decisions: (1) lead with district-jobs narrative in Strong meeting; (2) pair Raptor-X + Forge ML as one PE story; (3) hold SpectraNet for the Britt CDS lane. Follow-ups assigned in task list. Client temperature: 9/10 — renewal conversation appropriate after markup.',
  );
  if (debriefEnc) {
    await tx.meetingDebrief.create({ data: { tenantId, meetingId: pastMeeting.id, clientId, authorUserId: userId, ...debriefEnc } });
  }

  const upcomingMeeting = await tx.meeting.create({
    data: {
      tenantId, clientId, source: 'manual', subject: 'Hill day — Rep. Strong office (AL-05): FY27 NDAA language + plus-up',
      description: 'Member-level meeting. Deliver language request and one-pager; confirm sponsorship of the HAC-D letter.',
      location: '2228 Rayburn HOB', startsAt: daysFromNow(12), endsAt: new Date(daysFromNow(12).getTime() + 45 * 60_000),
      organizerEmail: USER_EMAIL, organizerName: 'Capiro', status: 'scheduled', createdByUserId: userId, metadata: { demo: true },
    },
  });
  await tx.meetingAttendee.createMany({
    data: [
      { tenantId, meetingId: upcomingMeeting.id, contactId: contactDoyle.id, email: 'katherine.doyle@mail.house.gov', name: 'Katherine Doyle', role: 'hill_staff', responseStatus: 'accepted' },
      { tenantId, meetingId: upcomingMeeting.id, email: `mbell@${domain}`, name: 'Marcus Bell', role: 'client', responseStatus: 'accepted' },
      { tenantId, meetingId: upcomingMeeting.id, email: USER_EMAIL, name: 'Capiro', role: 'organizer', responseStatus: 'accepted' },
    ],
  });
  await tx.meetingPrep.create({
    data: {
      tenantId, meetingId: upcomingMeeting.id, clientId, status: 'approved',
      agenda: ['Thank-you: FY25 conference plus-up outcome', 'FY27 NDAA language request (PE 0603270A, Project EW-4)', '$12.0M HAC-D plus-up — member letter ask', 'District nexus: 184 Huntsville jobs, integration center expansion'],
      talkingPoints: [
        'FY25 $8.0M plus-up executed on schedule via RCCTO OTA — clean track record.',
        'Yuma flight test met 9/10 objectives; report available to staff under NDA.',
        'Army EW CFT lists airborne electromagnetic attack as a near-term gap; Raptor-X is the only CMOSS-aligned podded payload at TRL 7.',
        'Ask: member letter to HAC-D supporting +$12.0M to PE 0603270A.',
      ],
      risks: ['HAC-D allocation pressure may cap plus-ups below $10M — be ready with a phased $9.5M fallback.', 'Competing EW primes briefing the same subcommittee week of 6/16.'],
      followUps: ['Send one-pager v3 + endorsement letter within 24h.', 'Offer Yuma test-report read-ahead to Doyle.', 'Confirm member letter signature by 7/1.'],
      summary: 'Member-level ask: NDAA language plus a HAC-D letter supporting +$12.0M to PE 0603270A, anchored on the FY25 win and the AL-05 district footprint.',
      provider: 'demo', model: 'demo-fixture', generatedFrom: { demo: true },
    },
  });

  await tx.engagementTask.createMany({
    data: [
      { tenantId, clientId, meetingId: upcomingMeeting.id, title: 'Finalize one-pager v3 (Raptor-X + Forge ML, single PE story)', description: 'Incorporate Yuma results; legal review of jobs figures.', ownerUserId: userId, dueDate: daysFromNow(6), status: 'in_progress', createdByUserId: userId },
      { tenantId, clientId, meetingId: pastMeeting.id, title: 'Circulate Yuma flight-test summary to client GR team', ownerUserId: userId, dueDate: daysFromNow(-8), status: 'done', createdByUserId: userId },
      { tenantId, clientId, title: 'Schedule SAC-D staff briefing (Britt office) — SpectraNet CDS', ownerUserId: userId, dueDate: daysFromNow(20), status: 'todo', createdByUserId: userId },
      { tenantId, clientId, contactId: contactRccto.id, title: 'Request RCCTO endorsement letter for FY27 submission', ownerUserId: userId, dueDate: daysFromNow(9), status: 'todo', createdByUserId: userId },
    ],
  });

  await tx.outreachRecord.create({
    data: {
      tenantId, clientId, createdByUserId: userId, type: 'follow_up', status: 'sent',
      title: 'Intro brief: Aperture EW payload — PEO IEW&S program office',
      subject: 'Raptor-X podded EW payload — capability brief for PM EW&C',
      body: 'Program office introduction with capability summary and OTA performance history. Requested 30-minute technical session ahead of FY27 cycle.',
      recipients: [{ name: 'COL (R) James Patton', email: 'james.patton.demo@army.example.mil' }],
      recipientCount: 1, sentAt: daysFromNow(-20), stats: { delivered: 1, opened: 1 }, metadata: { demo: true },
    },
  });

  const mailThread = await tx.mailThread.create({
    data: {
      tenantId, clientId, source: 'manual', subject: 'RE: FY27 RDT&E plus-up language — PE 0603270A',
      snippet: 'Thanks Marcus — LD reviewed the draft language. Two edits from Leg Counsel attached…',
      participants: [
        { name: 'Katherine Doyle', email: 'katherine.doyle@mail.house.gov' },
        { name: 'Marcus Bell', email: `mbell@${domain}` },
      ],
      lastMessageAt: daysFromNow(-3), status: 'open', metadata: { demo: true },
    },
  });
  await tx.mailMessage.createMany({
    data: [
      {
        tenantId, threadId: mailThread.id, source: 'manual', subject: 'FY27 RDT&E plus-up language — PE 0603270A',
        fromEmail: `mbell@${domain}`, fromName: 'Marcus Bell',
        toRecipients: [{ name: 'Katherine Doyle', email: 'katherine.doyle@mail.house.gov' }],
        sentAt: daysFromNow(-5), receivedAt: daysFromNow(-5),
        bodyText: 'Katherine — attached is draft language for the FY27 NDAA member request (PE 0603270A, Project EW-4) plus the one-page justification. Happy to walk staff through the Yuma results whenever convenient. — Marcus',
      },
      {
        tenantId, threadId: mailThread.id, source: 'manual', subject: 'RE: FY27 RDT&E plus-up language — PE 0603270A',
        fromEmail: 'katherine.doyle@mail.house.gov', fromName: 'Katherine Doyle',
        toRecipients: [{ name: 'Marcus Bell', email: `mbell@${domain}` }],
        ccRecipients: [{ name: 'Capiro', email: USER_EMAIL }],
        sentAt: daysFromNow(-3), receivedAt: daysFromNow(-3),
        bodyText: 'Thanks Marcus — LD reviewed the draft language. Two edits from Leg Counsel attached; otherwise the member is inclined to carry it. Please bring the final one-pager to the meeting on the 24th. — KD',
      },
    ],
  });

  // ── intelligence: LDA mapping, tracked bills, brief ──────────────────────
  if (refs.ldaClient) {
    await tx.clientIntelMapping.create({
      data: { tenantId, clientId, source: 'lda', externalId: String(refs.ldaClient.id), externalName: refs.ldaClient.name, confidence: 0.97, confirmed: true },
    });
  }
  if (refs.trackedBills.length > 0) {
    await tx.trackedBill.createMany({
      data: refs.trackedBills.map((bill, idx) => ({
        tenantId, clientId, billId: bill.id, createdBy: userId,
        note: idx === 0
          ? 'FY27 NDAA — tracking EW authorization language and committee marks for PE 0603270A.'
          : 'Defense policy vehicle — monitor for EW/spectrum provisions relevant to Raptor-X.',
      })),
    });
  }
  await tx.clientBrief.create({
    data: {
      tenantId, clientId, createdBy: userId, sourceType: 'manual',
      title: 'FY27 cycle brief — Aperture Defense Systems',
      body:
        'Position: dual-track FY27 push. NDAA language via Rep. Strong (AL-05) and a $12.0M HAC-D plus-up to PE 0603270A; CDS backup via Sen. Britt for SpectraNet ($6.5M). FY25 delivered $8.0M in conference — clean execution story. Watch items: HAC-D allocation pressure, competing EW primes on the Hill week of 6/16, and the HASC mark (currently +$11.5M above request). District nexus is the lead narrative: 184 Huntsville jobs, expansion announcement available to time with markup.',
    },
  });

  // ── Clio + action recommendations ────────────────────────────────────────
  await tx.clioNote.createMany({
    data: [
      { tenantId, userId, clientId, title: 'Strong office dynamics', body: 'LD (Doyle) is the real gatekeeper — member defers on defense tech asks. Lead with jobs numbers, then capability. Avoid acronym soup; CFT gap language resonated last cycle.', source: 'clio' },
      { tenantId, userId, clientId, title: 'FY27 ask structure', body: 'Client confirmed: $12.0M total = $9.5M integration + $2.5M developmental test. Fallback floor is $9.5M phased. Do not volunteer the fallback unless staff raises allocation pressure.', source: 'clio' },
    ],
  });
  await tx.clioProactiveAlert.create({
    data: {
      tenantId, clientId, alertType: 'pe_budget_change', priority: 'high', status: 'pending',
      title: 'HASC mark +$11.5M above request on PE 0603270A',
      body: 'The HASC FY27 mark for Electronic Warfare Advanced Payloads came in at $290.0M against a $278.5M request (+$11.5M). This strengthens the conference position for the client\'s $12.0M HAC-D ask. Recommend updating the member-letter narrative to cite the authorization mark.',
      sourceType: 'program_element', sourceId: PE_CODE, metadata: { peCode: PE_CODE, fy: 2027 },
    },
  });
  await tx.actionRecommendation.createMany({
    data: [
      {
        tenantId, clientId, peCode: PE_CODE, actionType: 'committee_engagement',
        issueTitle: 'Convert HASC plus-up into appropriations support before HAC-D markup',
        whatChanged: 'HASC FY27 mark for PE 0603270A is +$11.5M above the budget request ($290.0M vs $278.5M).',
        whyItMatters: 'Authorization momentum is the strongest available evidence for the client\'s $12.0M HAC-D plus-up; the window closes at subcommittee markup.',
        recommendedAction: 'Update the HAC-D member letter to cite the HASC mark; request Strong office circulate for signatures before markup; brief Calvert PSM with the revised one-pager.',
        targetAudience: ['HAC-D professional staff', 'Rep. Strong office'], suggestedArtifactType: 'member_letter',
        deadline: daysFromNow(21), deadlineSource: 'markup_calendar', ownerUserId: userId, priority: 85,
        confidence: { level: 'high', basis: 'committee_mark' },
        evidence: [{ type: 'pe_year', peCode: PE_CODE, fy: 2027, field: 'hascMark', value: 290.0 }],
        status: 'new',
      },
      {
        tenantId, clientId, actionType: 'hearing_prep',
        issueTitle: 'Army EW modernization posture hearing — written testimony opportunity',
        whatChanged: 'HASC CITI subcommittee scheduled an Army EW modernization posture hearing.',
        whyItMatters: 'Written testimony or a QFR pipeline puts the client\'s capability gap framing into the hearing record ahead of conference.',
        recommendedAction: 'Draft 2-page statement for the record; coordinate a QFR with Strong office on airborne electromagnetic attack capacity.',
        targetAudience: ['HASC CITI staff'], suggestedArtifactType: 'testimony',
        deadline: daysFromNow(14), deadlineSource: 'hearing_calendar', ownerUserId: userId, priority: 70,
        confidence: { level: 'medium', basis: 'hearing_notice' }, evidence: [], status: 'new',
      },
    ],
  });

  return { clientId, refreshed: Boolean(existing) };
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('SEED_ERR', error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
