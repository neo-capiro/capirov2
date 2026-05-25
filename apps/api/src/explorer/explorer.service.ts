import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Data Explorer service.
 *
 * Each method below is a typed query against ONE federal intelligence source
 * (LDA filings, federal contractors, etc.). They share a common pattern:
 *   - accept a free-text search term `q`
 *   - accept source-specific filter arrays
 *   - support sort + paginated limit/offset
 *   - return `{ rows, total }`
 *
 * Filters are applied as AND across keys, IN-style within a key. Page is
 * always 1-based. Default page size is 25 rows.
 */
@Injectable()
export class ExplorerService {
  constructor(private readonly prisma: PrismaService) {}

  /* ── LDA filings — the largest data set ─────────────────────────────── */

  async ldaFilings(opts: {
    q?: string;
    issueCodes?: string[];
    years?: number[];
    filingTypes?: string[];
    minIncome?: number;
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const limit = clampPageSize(opts.pageSize);
    const offset = ((opts.page ?? 1) - 1) * limit;
    const where: Prisma.LdaFilingWhereInput = {};
    if (opts.q) {
      where.OR = [
        { clientName: { contains: opts.q, mode: 'insensitive' } },
        { registrantName: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    if (opts.issueCodes?.length) where.issueCodes = { hasSome: opts.issueCodes };
    if (opts.years?.length) where.filingYear = { in: opts.years };
    if (opts.filingTypes?.length) where.filingType = { in: opts.filingTypes };
    if (opts.minIncome != null && opts.minIncome > 0) {
      where.income = { gte: new Prisma.Decimal(opts.minIncome) };
    }

    const orderBy = ldaSortClause(opts.sort);
    const [rows, total] = await Promise.all([
      this.prisma.ldaFiling.findMany({ where, orderBy, take: limit, skip: offset }),
      this.prisma.ldaFiling.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        filingUuid: r.filingUuid,
        filingType: r.filingType,
        filingYear: r.filingYear,
        filingPeriod: r.filingPeriod,
        income: r.income ? Number(r.income) : null,
        expenses: r.expenses ? Number(r.expenses) : null,
        dtPosted: r.dtPosted?.toISOString() ?? null,
        registrantName: r.registrantName,
        clientName: r.clientName,
        clientState: r.clientState,
        issueCodes: r.issueCodes ?? [],
      })),
      total,
    };
  }

  /* ── Federal contractors ────────────────────────────────────────────── */

  async federalContractors(opts: {
    q?: string;
    categories?: string[];
    hasNoBid?: boolean;
    minContracts?: number;
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const limit = clampPageSize(opts.pageSize);
    const offset = ((opts.page ?? 1) - 1) * limit;
    const where: Prisma.FederalContractorWhereInput = {};
    if (opts.q) where.name = { contains: opts.q, mode: 'insensitive' };
    if (opts.categories?.length) where.category = { in: opts.categories };
    if (opts.hasNoBid) where.noBidTotal = { gt: new Prisma.Decimal(0) };
    if (opts.minContracts != null && opts.minContracts > 0) {
      where.totalContracts = { gte: new Prisma.Decimal(opts.minContracts) };
    }

    const orderBy: Prisma.FederalContractorOrderByWithRelationInput =
      opts.sort === 'no-bid'
        ? { noBidTotal: { sort: 'desc', nulls: 'last' } }
        : opts.sort === 'name'
          ? { name: 'asc' }
          : { totalContracts: { sort: 'desc', nulls: 'last' } };

    const [rows, total] = await Promise.all([
      this.prisma.federalContractor.findMany({ where, orderBy, take: limit, skip: offset }),
      this.prisma.federalContractor.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        uei: r.uei,
        category: r.category,
        totalContracts: r.totalContracts ? Number(r.totalContracts) : null,
        pctOfAllContracts: r.pctOfAllContracts ? Number(r.pctOfAllContracts) : null,
        rankByContracts: r.rankByContracts,
        noBidTotal: r.noBidTotal ? Number(r.noBidTotal) : null,
        subsidiaries: r.subsidiaries,
      })),
      total,
    };
  }

  /* ── Congress bills ─────────────────────────────────────────────────── */

  async congressBills(opts: {
    q?: string;
    congress?: number[];
    subjects?: string[];
    sponsorParty?: string[];
    originChamber?: string[];
    policyAreas?: string[];
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const limit = clampPageSize(opts.pageSize);
    const offset = ((opts.page ?? 1) - 1) * limit;
    const where: Prisma.CongressBillWhereInput = {};
    if (opts.q) {
      where.OR = [
        { title: { contains: opts.q, mode: 'insensitive' } },
        { sponsorName: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    if (opts.congress?.length) where.congress = { in: opts.congress };
    if (opts.sponsorParty?.length) where.sponsorParty = { in: opts.sponsorParty };
    if (opts.originChamber?.length) where.originChamber = { in: opts.originChamber };
    if (opts.policyAreas?.length) where.policyArea = { in: opts.policyAreas };
    if (opts.subjects?.length) {
      where.subjectRefs = { some: { name: { in: opts.subjects } } };
    }

    const orderBy: Prisma.CongressBillOrderByWithRelationInput =
      opts.sort === 'introduced'
        ? { introducedDate: { sort: 'desc', nulls: 'last' } }
        : opts.sort === 'cosponsors'
          ? { cosponsorsCount: 'desc' }
          : { latestActionDate: { sort: 'desc', nulls: 'last' } };

    const [rows, total] = await Promise.all([
      this.prisma.congressBill.findMany({ where, orderBy, take: limit, skip: offset }),
      this.prisma.congressBill.count({ where }),
    ]);

    return {
      rows: rows.map((b) => ({
        id: b.id,
        congress: b.congress,
        billType: b.billType,
        billNumber: b.billNumber,
        title: b.title,
        introducedDate: b.introducedDate?.toISOString() ?? null,
        sponsorName: b.sponsorName,
        sponsorState: b.sponsorState,
        sponsorParty: b.sponsorParty,
        latestActionText: b.latestActionText,
        latestActionDate: b.latestActionDate?.toISOString() ?? null,
        policyArea: b.policyArea,
        cosponsorsCount: b.cosponsorsCount,
        originChamber: b.originChamber,
        url: b.url,
      })),
      total,
    };
  }

  /* ── Federal Register documents ─────────────────────────────────────── */

  async federalRegisterDocs(opts: {
    q?: string;
    types?: string[];
    agencies?: string[];
    significantOnly?: boolean;
    openCommentOnly?: boolean;
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const limit = clampPageSize(opts.pageSize);
    const offset = ((opts.page ?? 1) - 1) * limit;
    const where: Prisma.FederalRegisterDocumentWhereInput = {};
    if (opts.q) {
      where.OR = [
        { title: { contains: opts.q, mode: 'insensitive' } },
        { abstract: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    if (opts.types?.length) where.type = { in: opts.types };
    if (opts.agencies?.length) where.agencyNames = { hasSome: opts.agencies };
    if (opts.significantOnly) where.significantRule = true;
    if (opts.openCommentOnly) {
      where.commentEndDate = { gt: new Date() };
    }

    const orderBy: Prisma.FederalRegisterDocumentOrderByWithRelationInput =
      opts.sort === 'comment-close'
        ? { commentEndDate: { sort: 'asc', nulls: 'last' } }
        : { publicationDate: 'desc' };

    const [rows, total] = await Promise.all([
      this.prisma.federalRegisterDocument.findMany({ where, orderBy, take: limit, skip: offset }),
      this.prisma.federalRegisterDocument.count({ where }),
    ]);

    return {
      rows: rows.map((d) => ({
        id: d.id,
        documentNumber: d.documentNumber,
        type: d.type,
        title: d.title,
        agencyNames: d.agencyNames,
        publicationDate: d.publicationDate.toISOString(),
        commentEndDate: d.commentEndDate?.toISOString() ?? null,
        effectiveDate: d.effectiveDate?.toISOString() ?? null,
        topics: d.topics,
        significantRule: d.significantRule,
        htmlUrl: d.htmlUrl,
      })),
      total,
    };
  }

  /* ── Facets (filter dropdowns) ──────────────────────────────────────── */

  async ldaFacets() {
    const [issueCodes, years] = await Promise.all([
      this.prisma.ldaIssueCode.findMany({ select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.$queryRaw<Array<{ year: number }>>`
        SELECT DISTINCT filing_year AS year FROM lda_filing
        WHERE filing_year IS NOT NULL ORDER BY filing_year DESC LIMIT 10
      `,
    ]);
    return {
      issueCodes,
      years: years.map((r) => r.year),
      filingTypes: ['LD-2', 'LD-1', 'LD-2A', 'LD-203'],
    };
  }

  async contractorFacets() {
    const rows = await this.prisma.$queryRaw<Array<{ category: string | null }>>`
      SELECT DISTINCT category FROM federal_contractor
      WHERE category IS NOT NULL ORDER BY category ASC
    `;
    return { categories: rows.map((r) => r.category).filter((c): c is string => Boolean(c)) };
  }

  async billFacets() {
    const [congresses, subjects, chambers, parties, policyAreas] = await Promise.all([
      this.prisma.$queryRaw<Array<{ congress: number }>>`
        SELECT DISTINCT congress FROM congress_bill ORDER BY congress DESC LIMIT 6
      `,
      this.prisma.$queryRaw<Array<{ name: string; n: bigint }>>`
        SELECT name, COUNT(*)::bigint AS n
        FROM congress_bill_subject
        GROUP BY name ORDER BY n DESC LIMIT 30
      `,
      this.prisma.$queryRaw<Array<{ chamber: string }>>`
        SELECT DISTINCT origin_chamber AS chamber FROM congress_bill
        WHERE origin_chamber IS NOT NULL ORDER BY chamber
      `,
      this.prisma.$queryRaw<Array<{ party: string }>>`
        SELECT DISTINCT sponsor_party AS party FROM congress_bill
        WHERE sponsor_party IS NOT NULL ORDER BY party
      `,
      this.prisma.$queryRaw<Array<{ area: string }>>`
        SELECT DISTINCT policy_area AS area FROM congress_bill
        WHERE policy_area IS NOT NULL ORDER BY area LIMIT 50
      `,
    ]);
    return {
      congresses: congresses.map((r) => r.congress),
      subjects: subjects.map((r) => r.name),
      chambers: chambers.map((r) => r.chamber),
      parties: parties.map((r) => r.party),
      policyAreas: policyAreas.map((r) => r.area),
    };
  }

  async fedRegFacets() {
    const [types, agencies] = await Promise.all([
      this.prisma.$queryRaw<Array<{ type: string }>>`
        SELECT DISTINCT type FROM federal_register_document ORDER BY type
      `,
      this.prisma.$queryRaw<Array<{ agency: string; n: bigint }>>`
        SELECT agency, COUNT(*)::bigint AS n
        FROM federal_register_document, unnest(agency_names) AS agency
        GROUP BY agency ORDER BY n DESC LIMIT 50
      `,
    ]);
    return {
      types: types.map((r) => r.type),
      agencies: agencies.map((r) => r.agency),
    };
  }

  /* ── Committee hearings ─────────────────────────────────────────────── */

  async committeeHearings(opts: {
    q?: string;
    chambers?: string[];
    committees?: string[];
    types?: string[];
    futureOnly?: boolean;
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const limit = clampPageSize(opts.pageSize);
    const offset = ((opts.page ?? 1) - 1) * limit;
    const where: Prisma.CommitteeHearingWhereInput = {};
    if (opts.q) {
      where.OR = [
        { title: { contains: opts.q, mode: 'insensitive' } },
        { committeeName: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    if (opts.chambers?.length) where.chamber = { in: opts.chambers };
    if (opts.committees?.length) where.committeeName = { in: opts.committees };
    if (opts.types?.length) where.type = { in: opts.types };
    if (opts.futureOnly) where.date = { gte: new Date() };

    const orderBy: Prisma.CommitteeHearingOrderByWithRelationInput =
      opts.sort === 'past' ? { date: 'desc' } : { date: 'asc' };

    const [rows, total] = await Promise.all([
      this.prisma.committeeHearing.findMany({ where, orderBy, take: limit, skip: offset }),
      this.prisma.committeeHearing.count({ where }),
    ]);
    return {
      rows: rows.map((h) => ({
        id: h.id,
        chamber: h.chamber,
        committeeName: h.committeeName,
        committeeCode: h.committeeCode,
        title: h.title,
        date: h.date.toISOString(),
        time: h.time,
        location: h.location,
        type: h.type,
        witnesses: h.witnesses ?? [],
        url: h.url,
      })),
      total,
    };
  }

  async hearingFacets() {
    const [chambers, committees, types] = await Promise.all([
      this.prisma.$queryRaw<Array<{ chamber: string }>>`
        SELECT DISTINCT chamber FROM committee_hearing ORDER BY chamber
      `,
      this.prisma.$queryRaw<Array<{ committee: string; n: bigint }>>`
        SELECT committee_name AS committee, COUNT(*)::bigint AS n
        FROM committee_hearing GROUP BY committee_name ORDER BY n DESC LIMIT 40
      `,
      this.prisma.$queryRaw<Array<{ type: string }>>`
        SELECT DISTINCT type FROM committee_hearing WHERE type IS NOT NULL ORDER BY type
      `,
    ]);
    return {
      chambers: chambers.map((r) => r.chamber),
      committees: committees.map((r) => r.committee),
      types: types.map((r) => r.type),
    };
  }

  /* ── GAO reports ────────────────────────────────────────────────────── */

  async gaoReports(opts: {
    q?: string;
    reportTypes?: string[];
    topics?: string[];
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const limit = clampPageSize(opts.pageSize);
    const offset = ((opts.page ?? 1) - 1) * limit;
    const where: Prisma.GaoReportWhereInput = {};
    if (opts.q) where.title = { contains: opts.q, mode: 'insensitive' };
    if (opts.reportTypes?.length) where.reportType = { in: opts.reportTypes };
    if (opts.topics?.length) where.topics = { hasSome: opts.topics };

    const orderBy: Prisma.GaoReportOrderByWithRelationInput =
      opts.sort === 'recs'
        ? { recommendations: { sort: 'desc', nulls: 'last' } }
        : { publishDate: { sort: 'desc', nulls: 'last' } };

    const [rows, total] = await Promise.all([
      this.prisma.gaoReport.findMany({ where, orderBy, take: limit, skip: offset }),
      this.prisma.gaoReport.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        title: r.title,
        url: r.url,
        publishDate: r.publishDate?.toISOString() ?? null,
        reportType: r.reportType,
        topics: r.topics ?? [],
        agencies: r.agencies ?? [],
        summary: r.summary,
        recommendations: r.recommendations,
      })),
      total,
    };
  }

  async gaoFacets() {
    const [types, topics] = await Promise.all([
      this.prisma.$queryRaw<Array<{ t: string }>>`
        SELECT DISTINCT report_type AS t FROM gao_report WHERE report_type IS NOT NULL ORDER BY t
      `,
      this.prisma.$queryRaw<Array<{ topic: string; n: bigint }>>`
        SELECT topic, COUNT(*)::bigint AS n
        FROM gao_report, unnest(topics) AS topic
        GROUP BY topic ORDER BY n DESC LIMIT 30
      `,
    ]);
    return {
      reportTypes: types.map((r) => r.t),
      topics: topics.map((r) => r.topic),
    };
  }

  /* ── CRS reports ────────────────────────────────────────────────────── */

  async crsReports(opts: {
    q?: string;
    topics?: string[];
    activeOnly?: boolean;
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const limit = clampPageSize(opts.pageSize);
    const offset = ((opts.page ?? 1) - 1) * limit;
    const where: Prisma.CrsReportWhereInput = {};
    if (opts.q) where.title = { contains: opts.q, mode: 'insensitive' };
    if (opts.topics?.length) where.topics = { hasSome: opts.topics };
    if (opts.activeOnly) where.active = true;

    const [rows, total] = await Promise.all([
      this.prisma.crsReport.findMany({
        where,
        orderBy: { date: { sort: 'desc', nulls: 'last' } },
        take: limit,
        skip: offset,
      }),
      this.prisma.crsReport.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        title: r.title,
        date: r.date?.toISOString() ?? null,
        authors: r.authors ?? [],
        topics: r.topics ?? [],
        summary: r.summary,
        pdfUrl: r.pdfUrl,
        htmlUrl: r.htmlUrl,
        active: r.active,
      })),
      total,
    };
  }

  async crsFacets() {
    const topics = await this.prisma.$queryRaw<Array<{ topic: string; n: bigint }>>`
      SELECT topic, COUNT(*)::bigint AS n
      FROM crs_report, unnest(topics) AS topic
      GROUP BY topic ORDER BY n DESC LIMIT 30
    `;
    return { topics: topics.map((r) => r.topic) };
  }

  /* ── FEC contributions ──────────────────────────────────────────────── */

  async fecContributions(opts: {
    q?: string;
    cycles?: number[];
    states?: string[];
    minAmount?: number;
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const limit = clampPageSize(opts.pageSize);
    const offset = ((opts.page ?? 1) - 1) * limit;
    const where: Prisma.FecContributionWhereInput = {};
    if (opts.q) {
      where.OR = [
        { contributorName: { contains: opts.q, mode: 'insensitive' } },
        { contributorEmployer: { contains: opts.q, mode: 'insensitive' } },
        { committeeName: { contains: opts.q, mode: 'insensitive' } },
        { candidateName: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    if (opts.cycles?.length) where.cycle = { in: opts.cycles };
    if (opts.states?.length) where.state = { in: opts.states };
    if (opts.minAmount != null && opts.minAmount > 0) {
      where.amount = { gte: new Prisma.Decimal(opts.minAmount) };
    }

    const orderBy: Prisma.FecContributionOrderByWithRelationInput =
      opts.sort === 'date'
        ? { contributionDate: { sort: 'desc', nulls: 'last' } }
        : { amount: 'desc' };

    const [rows, total] = await Promise.all([
      this.prisma.fecContribution.findMany({ where, orderBy, take: limit, skip: offset }),
      this.prisma.fecContribution.count({ where }),
    ]);
    return {
      rows: rows.map((c) => ({
        id: c.id,
        committeeId: c.committeeId,
        committeeName: c.committeeName,
        candidateId: c.candidateId,
        candidateName: c.candidateName,
        contributorName: c.contributorName,
        contributorEmployer: c.contributorEmployer,
        contributorOccupation: c.contributorOccupation,
        amount: Number(c.amount),
        contributionDate: c.contributionDate?.toISOString() ?? null,
        receiptType: c.receiptType,
        state: c.state,
        cycle: c.cycle,
      })),
      total,
    };
  }

  async fecFacets() {
    const [cycles, states] = await Promise.all([
      this.prisma.$queryRaw<Array<{ cycle: number }>>`
        SELECT DISTINCT cycle FROM fec_contribution ORDER BY cycle DESC LIMIT 6
      `,
      this.prisma.$queryRaw<Array<{ state: string }>>`
        SELECT DISTINCT state FROM fec_contribution
        WHERE state IS NOT NULL AND state <> '' ORDER BY state
      `,
    ]);
    return {
      cycles: cycles.map((r) => r.cycle),
      states: states.map((r) => r.state),
    };
  }

  /* ── FARA registrations ─────────────────────────────────────────────── */

  async faraRegistrations(opts: {
    q?: string;
    countries?: string[];
    statuses?: string[];
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const limit = clampPageSize(opts.pageSize);
    const offset = ((opts.page ?? 1) - 1) * limit;
    const where: Prisma.FaraRegistrationWhereInput = {};
    if (opts.q) {
      where.OR = [
        { registrantName: { contains: opts.q, mode: 'insensitive' } },
        { foreignPrincipal: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    if (opts.countries?.length) where.country = { in: opts.countries };
    if (opts.statuses?.length) where.status = { in: opts.statuses };

    const orderBy: Prisma.FaraRegistrationOrderByWithRelationInput =
      opts.sort === 'oldest'
        ? { registrationDate: { sort: 'asc', nulls: 'last' } }
        : { registrationDate: { sort: 'desc', nulls: 'last' } };

    const [rows, total] = await Promise.all([
      this.prisma.faraRegistration.findMany({ where, orderBy, take: limit, skip: offset }),
      this.prisma.faraRegistration.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        registrationNumber: r.registrationNumber,
        registrantName: r.registrantName,
        foreignPrincipal: r.foreignPrincipal,
        country: r.country,
        status: r.status,
        registrationDate: r.registrationDate?.toISOString() ?? null,
        terminationDate: r.terminationDate?.toISOString() ?? null,
        state: r.state,
        description: r.description,
      })),
      total,
    };
  }

  async faraFacets() {
    const [countries, statuses] = await Promise.all([
      this.prisma.$queryRaw<Array<{ country: string; n: bigint }>>`
        SELECT country, COUNT(*)::bigint AS n FROM fara_registration
        WHERE country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 50
      `,
      this.prisma.$queryRaw<Array<{ status: string }>>`
        SELECT DISTINCT status FROM fara_registration WHERE status IS NOT NULL ORDER BY status
      `,
    ]);
    return {
      countries: countries.map((r) => r.country),
      statuses: statuses.map((r) => r.status),
    };
  }

  /* ── SEC filings ────────────────────────────────────────────────────── */

  async secFilings(opts: {
    q?: string;
    formTypes?: string[];
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const limit = clampPageSize(opts.pageSize);
    const offset = ((opts.page ?? 1) - 1) * limit;
    const where: Prisma.SecFilingWhereInput = {};
    if (opts.q) {
      where.OR = [
        { companyName: { contains: opts.q, mode: 'insensitive' } },
        { description: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    if (opts.formTypes?.length) where.formType = { in: opts.formTypes };

    const [rows, total] = await Promise.all([
      this.prisma.secFiling.findMany({
        where,
        orderBy: { filingDate: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.secFiling.count({ where }),
    ]);
    return {
      rows: rows.map((f) => ({
        id: f.id,
        cik: f.cik,
        companyName: f.companyName,
        formType: f.formType,
        accessionNumber: f.accessionNumber,
        filingDate: f.filingDate.toISOString(),
        reportDate: f.reportDate?.toISOString() ?? null,
        description: f.description,
        sic: f.sic,
        url: f.url,
      })),
      total,
    };
  }

  async secFacets() {
    const formTypes = await this.prisma.$queryRaw<Array<{ t: string; n: bigint }>>`
      SELECT form_type AS t, COUNT(*)::bigint AS n
      FROM sec_filing GROUP BY form_type ORDER BY n DESC LIMIT 25
    `;
    return { formTypes: formTypes.map((r) => r.t) };
  }

  /* ── Intel articles (news) ──────────────────────────────────────────── */

  async intelArticles(opts: {
    q?: string;
    sources?: string[];
    topics?: string[];
    agencies?: string[];
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const limit = clampPageSize(opts.pageSize);
    const offset = ((opts.page ?? 1) - 1) * limit;
    const where: Prisma.IntelArticleWhereInput = {};
    if (opts.q) {
      where.OR = [
        { title: { contains: opts.q, mode: 'insensitive' } },
        { summary: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    if (opts.sources?.length) where.source = { in: opts.sources };
    if (opts.topics?.length) where.topics = { hasSome: opts.topics };
    if (opts.agencies?.length) where.agencies = { hasSome: opts.agencies };

    const [rows, total] = await Promise.all([
      this.prisma.intelArticle.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.intelArticle.count({ where }),
    ]);
    return {
      rows: rows.map((a) => ({
        id: a.id,
        source: a.source,
        title: a.title,
        url: a.url,
        author: a.author,
        publishedAt: a.publishedAt.toISOString(),
        summary: a.summary,
        topics: a.topics ?? [],
        agencies: a.agencies ?? [],
      })),
      total,
    };
  }

  async intelArticleFacets() {
    const [sources, topics, agencies] = await Promise.all([
      this.prisma.$queryRaw<Array<{ s: string; n: bigint }>>`
        SELECT source AS s, COUNT(*)::bigint AS n
        FROM intel_article GROUP BY source ORDER BY n DESC LIMIT 30
      `,
      this.prisma.$queryRaw<Array<{ topic: string; n: bigint }>>`
        SELECT topic, COUNT(*)::bigint AS n
        FROM intel_article, unnest(topics) AS topic
        GROUP BY topic ORDER BY n DESC LIMIT 30
      `,
      this.prisma.$queryRaw<Array<{ agency: string; n: bigint }>>`
        SELECT agency, COUNT(*)::bigint AS n
        FROM intel_article, unnest(agencies) AS agency
        GROUP BY agency ORDER BY n DESC LIMIT 30
      `,
    ]);
    return {
      sources: sources.map((r) => r.s),
      topics: topics.map((r) => r.topic),
      agencies: agencies.map((r) => r.agency),
    };
  }

  /* ── State bills ────────────────────────────────────────────────────── */

  async stateBills(opts: {
    q?: string;
    states?: string[];
    subjects?: string[];
    sponsorParty?: string[];
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const limit = clampPageSize(opts.pageSize);
    const offset = ((opts.page ?? 1) - 1) * limit;
    const where: Prisma.StateBillWhereInput = {};
    if (opts.q) {
      where.OR = [
        { title: { contains: opts.q, mode: 'insensitive' } },
        { sponsorName: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    if (opts.states?.length) where.state = { in: opts.states };
    if (opts.subjects?.length) where.subjects = { hasSome: opts.subjects };
    if (opts.sponsorParty?.length) where.sponsorParty = { in: opts.sponsorParty };

    const [rows, total] = await Promise.all([
      this.prisma.stateBill.findMany({
        where,
        orderBy: { latestActionDate: { sort: 'desc', nulls: 'last' } },
        take: limit,
        skip: offset,
      }),
      this.prisma.stateBill.count({ where }),
    ]);
    return {
      rows: rows.map((b) => ({
        id: b.id,
        state: b.state,
        session: b.session,
        identifier: b.identifier,
        title: b.title,
        chamber: b.chamber,
        classification: b.classification ?? [],
        subjects: b.subjects ?? [],
        sponsorName: b.sponsorName,
        sponsorParty: b.sponsorParty,
        latestActionDate: b.latestActionDate?.toISOString() ?? null,
        latestActionText: b.latestActionText,
        url: b.url,
      })),
      total,
    };
  }

  async stateBillFacets() {
    const [states, subjects, parties] = await Promise.all([
      this.prisma.$queryRaw<Array<{ state: string; n: bigint }>>`
        SELECT state, COUNT(*)::bigint AS n FROM state_bill GROUP BY state ORDER BY n DESC LIMIT 60
      `,
      this.prisma.$queryRaw<Array<{ subject: string; n: bigint }>>`
        SELECT subject, COUNT(*)::bigint AS n
        FROM state_bill, unnest(subjects) AS subject
        GROUP BY subject ORDER BY n DESC LIMIT 30
      `,
      this.prisma.$queryRaw<Array<{ party: string }>>`
        SELECT DISTINCT sponsor_party AS party FROM state_bill
        WHERE sponsor_party IS NOT NULL ORDER BY party
      `,
    ]);
    return {
      states: states.map((r) => r.state),
      subjects: subjects.map((r) => r.subject),
      parties: parties.map((r) => r.party),
    };
  }

  /* ── Row drill-in: full record + related lookups ────────────────────── */

  async ldaFilingDetail(id: string) {
    const filing = await this.prisma.ldaFiling.findUnique({ where: { id } });
    if (!filing) return null;

    // Related: same registrant's recent filings, same client's recent filings,
    // and human-friendly issue-code names.
    const [registrantRecent, clientRecent, codeRows] = await Promise.all([
      this.prisma.ldaFiling.findMany({
        where: { registrantName: filing.registrantName, id: { not: filing.id } },
        orderBy: { dtPosted: { sort: 'desc', nulls: 'last' } },
        take: 5,
      }),
      filing.clientId
        ? this.prisma.ldaFiling.findMany({
            where: { clientId: filing.clientId, id: { not: filing.id } },
            orderBy: { dtPosted: { sort: 'desc', nulls: 'last' } },
            take: 5,
          })
        : Promise.resolve([]),
      filing.issueCodes.length
        ? this.prisma.ldaIssueCode.findMany({
            where: { code: { in: filing.issueCodes } },
            select: { code: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    return {
      filing: {
        ...filing,
        income: filing.income ? Number(filing.income) : null,
        expenses: filing.expenses ? Number(filing.expenses) : null,
        dtPosted: filing.dtPosted?.toISOString() ?? null,
      },
      registrantRecent: registrantRecent.map((r) => ({
        id: r.id,
        filingYear: r.filingYear,
        filingPeriod: r.filingPeriod,
        clientName: r.clientName,
        income: r.income ? Number(r.income) : null,
      })),
      clientRecent: clientRecent.map((r) => ({
        id: r.id,
        filingYear: r.filingYear,
        filingPeriod: r.filingPeriod,
        registrantName: r.registrantName,
        income: r.income ? Number(r.income) : null,
      })),
      issueCodes: codeRows,
    };
  }

  async billDetail(id: string) {
    const bill = await this.prisma.congressBill.findUnique({
      where: { id },
      include: {
        actions: { orderBy: { date: 'desc' }, take: 12 },
        committeeRefs: true,
        subjectRefs: true,
      },
    });
    if (!bill) return null;
    return {
      bill: {
        ...bill,
        introducedDate: bill.introducedDate?.toISOString() ?? null,
        latestActionDate: bill.latestActionDate?.toISOString() ?? null,
        updateDate: bill.updateDate?.toISOString() ?? null,
        actions: bill.actions.map((a) => ({
          id: a.id,
          date: a.date.toISOString(),
          text: a.text,
          type: a.type,
          chamber: a.chamber,
        })),
      },
    };
  }

  async contractorDetail(id: string) {
    const c = await this.prisma.federalContractor.findUnique({ where: { id } });
    if (!c) return null;
    return {
      contractor: {
        ...c,
        totalContracts: c.totalContracts ? Number(c.totalContracts) : null,
        pctOfAllContracts: c.pctOfAllContracts ? Number(c.pctOfAllContracts) : null,
        costPerTaxpayer: c.costPerTaxpayer ? Number(c.costPerTaxpayer) : null,
        noBidTotal: c.noBidTotal ? Number(c.noBidTotal) : null,
      },
    };
  }

  async fedRegDetail(id: string) {
    const d = await this.prisma.federalRegisterDocument.findUnique({ where: { id } });
    if (!d) return null;
    return {
      document: {
        ...d,
        publicationDate: d.publicationDate.toISOString(),
        commentEndDate: d.commentEndDate?.toISOString() ?? null,
        effectiveDate: d.effectiveDate?.toISOString() ?? null,
      },
    };
  }

  /* ── Detail endpoints for the 8 newer sources ──────────────────────── */

  async hearingDetail(id: string) {
    const h = await this.prisma.committeeHearing.findUnique({ where: { id } });
    if (!h) return null;
    return {
      hearing: {
        ...h,
        date: h.date.toISOString(),
      },
    };
  }

  async gaoDetail(id: string) {
    const r = await this.prisma.gaoReport.findUnique({ where: { id } });
    if (!r) return null;
    return {
      report: {
        ...r,
        publishDate: r.publishDate?.toISOString() ?? null,
      },
    };
  }

  async crsDetail(id: string) {
    const r = await this.prisma.crsReport.findUnique({ where: { id } });
    if (!r) return null;
    return {
      report: {
        ...r,
        date: r.date?.toISOString() ?? null,
      },
    };
  }

  async fecDetail(id: string) {
    const c = await this.prisma.fecContribution.findUnique({ where: { id } });
    if (!c) return null;
    return {
      contribution: {
        ...c,
        amount: c.amount ? Number(c.amount) : 0,
        contributionDate: c.contributionDate?.toISOString() ?? null,
      },
    };
  }

  async faraDetail(id: string) {
    const r = await this.prisma.faraRegistration.findUnique({ where: { id } });
    if (!r) return null;
    return {
      registration: {
        ...r,
        registrationDate: r.registrationDate?.toISOString() ?? null,
        terminationDate: r.terminationDate?.toISOString() ?? null,
      },
    };
  }

  async secDetail(id: string) {
    const f = await this.prisma.secFiling.findUnique({ where: { id } });
    if (!f) return null;
    return {
      filing: {
        ...f,
        filingDate: f.filingDate.toISOString(),
        reportDate: f.reportDate?.toISOString() ?? null,
      },
    };
  }

  async intelArticleDetail(id: string) {
    const a = await this.prisma.intelArticle.findUnique({ where: { id } });
    if (!a) return null;
    return {
      article: {
        ...a,
        publishedAt: a.publishedAt.toISOString(),
      },
    };
  }

  async stateBillDetail(id: string) {
    const b = await this.prisma.stateBill.findUnique({ where: { id } });
    if (!b) return null;
    return {
      bill: {
        ...b,
        latestActionDate: b.latestActionDate?.toISOString() ?? null,
      },
    };
  }
}

function clampPageSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 1) return 25;
  return Math.min(value, 200);
}

function ldaSortClause(sort: string | undefined): Prisma.LdaFilingOrderByWithRelationInput {
  switch (sort) {
    case 'income':
      return { income: { sort: 'desc', nulls: 'last' } };
    case 'year':
      return { filingYear: 'desc' };
    case 'client':
      return { clientName: 'asc' };
    case 'registrant':
      return { registrantName: 'asc' };
    case 'recent':
    default:
      return { dtPosted: { sort: 'desc', nulls: 'last' } };
  }
}
