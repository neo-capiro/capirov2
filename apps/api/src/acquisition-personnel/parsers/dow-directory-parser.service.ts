import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AcquisitionPersonnelWriterService } from '../acquisition-personnel-writer.service.js';
import { fetchJson } from '../../clio/sources/http.js';
import { DowDirectorySectionChunk, DowDirectorySectionSplitterService } from './dow-directory-section-splitter.service.js';
import { isValidPeCode } from '../../program-element/jbook/jbook-extract.js';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { PDFDocument } from 'pdf-lib';

const FIRECRAWL_ROOT = 'https://api.firecrawl.dev/v1/';
const MAX_CREDITS = 20_000;

export interface DowDirectoryPersonRecord {
  full_name: string;
  rank?: 'GEN' | 'LTG' | 'MG' | 'BG' | 'COL' | 'LTC' | 'MAJ' | 'CPT' | 'ADM' | 'VADM' | 'RADM' | 'CAPT' | 'CDR' | 'LCDR' | 'LT' | 'LTJG' | 'ENS' | 'SES' | 'CIV' | null;
  honorific?: 'DR' | 'MR' | 'MS' | 'MRS' | 'HON' | 'SEC' | 'AMB' | null;
  suffix?: string;
  title?: string;
  organization?: string;
  sub_organization?: string;
  duty_station?: string;
  service?: 'ARMY' | 'NAVY' | 'AF' | 'SF' | 'USMC' | 'OSD' | 'DARPA' | 'DW' | 'CONGRESS' | 'OMB' | 'WH' | 'OTHER';
  role?: 'PEO' | 'DPEO' | 'PM' | 'DPM' | 'PCO' | 'KO' | 'COR' | 'CE' | 'TD' | 'SMA' | 'DIRECTOR' | 'DEP_DIRECTOR' | 'SECRETARY' | 'UNDERSECRETARY' | 'STAFFER' | 'STAFF_DIRECTOR' | 'POLICY_DIRECTOR' | 'PROFESSIONAL_STAFF' | 'OTHER';
  functional_area?: string;
  email_full?: string;
  public_profile_url?: string;
  link_type?: string;
  pe_account_title?: string;
  pe_org_code?: string;
  budget_activity_title?: string;
  pe_code?: string;
  pe_title?: string;
  programs_mentioned?: string[];
  alignment_confidence?: 'inferred' | 'explicit' | 'strong' | 'weak';
  sales_tier?: '1_decision_maker' | '2_influencer' | '3_supporting' | '3_vacant';
  submission_relevance?: 'high' | 'medium' | 'low';
  decision_authority?: string;
  why_matters_to_capiro?: string;
  subject_matter_area?: string;
  status: 'active' | 'vacant' | 'acting';
  source_pdf_version: string;
  source_pdf_date: string;
  source_page: number;
  source_section: string;
  extraction_confidence: number;
  notes?: string;
}

export interface DowDirectorySectionExtraction {
  section_title: string;
  section_organization: string;
  section_page_start: number;
  section_page_end: number;
  personnel: DowDirectoryPersonRecord[];
}

export interface DowDirectoryExtractionClient {
  extractSection(params: {
    section: DowDirectorySectionChunk;
    sectionPdf: Buffer;
    sourcePdfPresignedUrl: string;
  }): Promise<{ result: DowDirectorySectionExtraction; creditsConsumed: number }>;
}

export interface ParseDowDirectoryInput {
  pdfPath: string;
  pdfBuffer: Buffer;
  sourceVersion?: string;
}

export interface ParseDowDirectoryStats {
  sections_processed: number;
  persons_inserted: number;
  persons_addSourceMentioned: number;
  persons_quarantined: number;
  vacancies_detected: number;
  total_firecrawl_credits_consumed: number;
  runtime_seconds: number;
  failed_sections: string[];
}

const PERSONNEL_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    section_title: { type: 'string' },
    section_organization: { type: 'string' },
    section_page_start: { type: 'integer' },
    section_page_end: { type: 'integer' },
    personnel: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          full_name: { type: 'string', minLength: 2 },
          rank: { type: 'string' },
          honorific: { type: 'string' },
          suffix: { type: 'string' },
          title: { type: 'string' },
          organization: { type: 'string' },
          sub_organization: { type: 'string' },
          duty_station: { type: 'string' },
          service: { type: 'string' },
          role: { type: 'string' },
          functional_area: { type: 'string' },
          email_full: { type: 'string' },
          public_profile_url: { type: 'string' },
          link_type: { type: 'string' },
          pe_account_title: { type: 'string' },
          pe_org_code: { type: 'string' },
          budget_activity_title: { type: 'string' },
          pe_code: { type: 'string' },
          pe_title: { type: 'string' },
          programs_mentioned: { type: 'array', items: { type: 'string' } },
          alignment_confidence: { type: 'string' },
          sales_tier: { type: 'string' },
          submission_relevance: { type: 'string' },
          decision_authority: { type: 'string' },
          why_matters_to_capiro: { type: 'string' },
          subject_matter_area: { type: 'string' },
          status: { type: 'string' },
          source_pdf_version: { type: 'string' },
          source_pdf_date: { type: 'string' },
          source_page: { type: 'integer', minimum: 1 },
          source_section: { type: 'string' },
          extraction_confidence: { type: 'number', minimum: 0, maximum: 1 },
          notes: { type: 'string' },
        },
        required: ['full_name','organization','service','title','role','status','source_pdf_version','source_pdf_date','source_page','source_section','extraction_confidence'],
      },
    },
  },
  required: ['section_title','section_organization','section_page_start','section_page_end','personnel'],
};

const EXTRACTION_PROMPT = `You extract structured personnel records from the DoW Directory — the Department of War / Department of Defense personnel directory.

You will receive a section of the directory (typically 1-20 pages). Multiple people appear per section, grouped under organizational headings. Extract every named person on every page.

Rules:
1. NEVER invent values. If a field is not visible in the source, omit it.
2. Names: extract the personal name only. Strip military rank (BG, COL) and civilian honorifics (Mr., Dr.) into the rank and honorific fields. Strip suffixes (Jr., USAF) into the suffix field. Example: "BG Edward M. Barker, USA" → full_name="Edward M. Barker", rank="BG", suffix="USA".
3. Vacancies: if the directory lists "VACANT" or "Position Open", set full_name to "VACANT (<title>)", status="vacant", sales_tier="3_vacant".
4. Emails: if a full email is printed, return it in email_full. The writer service strips to domain before storage — do not try to redact here.
5. Profile/bio URLs: extract only if printed. Skip strings like "No link found" or "No link" — set link_type="no_link" and omit public_profile_url.
6. Role inference: parse from title. "Program Executive Officer" → PEO; "Deputy Program Manager" → DPM; "Procuring Contracting Officer" → PCO; "Contracting Officer" → KO; "Chief Engineer" → CE; "Technical Director" → TD; "Senior Materiel Leader" → SMA; "Staff Director" → STAFF_DIRECTOR; "Professional Staff" → PROFESSIONAL_STAFF. Use OTHER if no enum matches.
7. Service derivation: from organization or section context. OSD = Office of the Secretary of Defense. CONGRESS for any committee staff. OMB and WH for executive-branch budget/policy.
8. Sales tier: 1_decision_maker for direct budget/acquisition/legislative authority. 2_influencer for shapers/policy drafters/principals' advisors. 3_supporting for technical/admin staff. 3_vacant for open positions.
9. why_matters_to_capiro: ONE sentence stating the operational relevance of this person to a government affairs professional. Do not invent — anchor in the role and section context.
10. Required fields per person: full_name, organization, service, title, role, status, source_pdf_version, source_pdf_date, source_page, source_section, extraction_confidence. If any of these cannot be determined, set extraction_confidence below 0.6 — the writer will quarantine.

Output strict JSON matching the schema. Return personnel as an array; empty array is valid if a section has no named individuals.`;

@Injectable()
export class DowDirectoryParserService {
  private readonly logger = new Logger(DowDirectoryParserService.name);
  private readonly s3: S3Client;
  private readonly s3Bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly personnelWriter: AcquisitionPersonnelWriterService,
    private readonly sectionSplitter: DowDirectorySectionSplitterService,
    private readonly extractionClient: DowDirectoryExtractionClient = new FirecrawlDowDirectoryExtractionClient(),
  ) {
    const region = process.env.AWS_REGION ?? process.env.AWS_REGION_DEFAULT ?? 'us-east-1';
    this.s3 = new S3Client({ region });
    this.s3Bucket = process.env.DOW_DIRECTORY_CACHE_BUCKET ?? 'capiro-pdf-cache';
  }

  async parseDirectory(input: ParseDowDirectoryInput): Promise<ParseDowDirectoryStats> {
    const startedAtMs = Date.now();
    const fileName = basename(input.pdfPath);
    const pageCount = (await PDFDocument.load(input.pdfBuffer)).getPageCount();
    const pdfSha = createHash('sha256').update(input.pdfBuffer).digest('hex');
    const sourceVersion = input.sourceVersion ?? this.parseSourceVersion(fileName);
    const observedAt = this.parseSourceDate(fileName);

    await this.ensureExtractionCacheTable();
    await this.uploadPdfCacheIfMissing(sourceVersion, input.pdfBuffer);

    const syncRun = await this.prisma.syncRun.create({
      data: {
        source: `parse:dow-directory:${sourceVersion}`,
        startedAt: new Date(),
        status: 'running',
      },
    });

    const stats: ParseDowDirectoryStats = {
      sections_processed: 0,
      persons_inserted: 0,
      persons_addSourceMentioned: 0,
      persons_quarantined: 0,
      vacancies_detected: 0,
      total_firecrawl_credits_consumed: 0,
      runtime_seconds: 0,
      failed_sections: [],
    };

    try {
      const sections = await this.sectionSplitter.splitIntoSections(input.pdfBuffer);
      const sectionPdfUrl = await this.getCachedPdfReadUrl(sourceVersion);

      this.logger.log(`DoW parse sections to process: ${sections.length}`);

      for (const section of sections) {
        this.logger.log(`Processing section ${section.title} p.${section.pageStart}-${section.pageEnd}`);
        if (stats.total_firecrawl_credits_consumed > MAX_CREDITS) {
          stats.failed_sections.push(`${section.title} (circuit-breaker)`);
          continue;
        }

        let extracted: DowDirectorySectionExtraction;

        try {
          const cached = await this.getCachedExtraction(pdfSha, section.pageStart, section.pageEnd);
          if (cached) {
            extracted = cached.result;
            stats.total_firecrawl_credits_consumed += 0;
          } else {
            const fresh = await this.extractionClient.extractSection({
              section,
              sectionPdf: section.buffer,
              sourcePdfPresignedUrl: this.withSectionFragment(sectionPdfUrl, section.pageStart, section.pageEnd),
            });
            extracted = fresh.result;
            stats.total_firecrawl_credits_consumed += fresh.creditsConsumed;
            await this.setCachedExtraction(pdfSha, section.pageStart, section.pageEnd, extracted, fresh.creditsConsumed);
          }
        } catch (error) {
          this.logger.error(`Extraction failed for section ${section.title}: ${(error as Error).message}`);
          stats.failed_sections.push(section.title);
          continue;
        }

        stats.sections_processed += 1;

        for (const person of extracted.personnel ?? []) {
          const quarantined = await this.validateAndWritePerson({
            record: person,
            sourceVersion,
            observedAt,
            pageCount,
            stats,
          });
          if (quarantined) continue;
        }
      }

      stats.runtime_seconds = Math.round((Date.now() - startedAtMs) / 1000);

      await this.prisma.syncRun.update({
        where: { id: syncRun.id },
        data: {
          finishedAt: new Date(),
          rowsInserted: stats.persons_inserted,
          rowsUpdated: stats.persons_addSourceMentioned,
          errorCount: stats.persons_quarantined + stats.failed_sections.length,
          status: stats.failed_sections.length > 0 ? 'completed_with_errors' : 'completed',
        },
      });

      return stats;
    } catch (error) {
      await this.prisma.syncRun.update({
        where: { id: syncRun.id },
        data: {
          finishedAt: new Date(),
          rowsInserted: stats.persons_inserted,
          rowsUpdated: stats.persons_addSourceMentioned,
          errorCount: stats.persons_quarantined + stats.failed_sections.length + 1,
          status: 'failed',
          errorMessage: (error as Error).message,
        },
      });
      throw error;
    }
  }

  private async validateAndWritePerson(input: {
    record: DowDirectoryPersonRecord;
    sourceVersion: string;
    observedAt: Date;
    pageCount: number;
    stats: ParseDowDirectoryStats;
  }): Promise<boolean> {
    const { record, sourceVersion, observedAt, pageCount, stats } = input;

    const sourceTag = `dow_directory_${sourceVersion}`;
    const fullName = (record.full_name ?? '').trim();

    if ((record.extraction_confidence ?? 0) < 0.5 && record.status !== 'vacant') {
      await this.personnelWriter.quarantine(record, 'low_confidence_extraction', sourceTag);
      stats.persons_quarantined += 1;
      return true;
    }

    if (fullName.length < 3 || /\d/.test(fullName)) {
      await this.personnelWriter.quarantine(record, 'invalid_name', sourceTag);
      stats.persons_quarantined += 1;
      return true;
    }

    if ((record.service ?? 'OTHER') === 'OTHER' && !(record.organization ?? '').trim()) {
      await this.personnelWriter.quarantine(record, 'ungrouped', sourceTag);
      stats.persons_quarantined += 1;
      return true;
    }

    if (!Number.isFinite(record.source_page) || record.source_page < 1 || record.source_page > pageCount) {
      await this.personnelWriter.quarantine(record, 'invalid_page', sourceTag);
      stats.persons_quarantined += 1;
      return true;
    }

    let peCode: string | undefined = record.pe_code?.trim() || undefined;
    if (peCode) {
      const formatOk = isValidPeCode(peCode);
      const exists = formatOk
        ? !!(await this.prisma.programElement.findUnique({ where: { peCode }, select: { peCode: true } }))
        : false;

      if (!formatOk || !exists) {
        this.logger.warn(`Dropping invalid/unknown pe_code ${peCode} for ${fullName}`);
        peCode = undefined;
      }
    }

    const emailDomain = this.extractEmailDomain(record.email_full);
    const confidence = Math.max(0.3, Math.min(0.95, record.extraction_confidence ?? 0.3));
    const sourceUrl = `s3://${this.s3Bucket}/dow-directory/${sourceVersion}.pdf#page=${record.source_page}`;

    const result = await this.personnelWriter.upsertPerson(
      {
        fullName: this.assembleFullName(record),
        title: record.title,
        organization: record.organization,
        service: record.service,
        role: record.role,
        emailDomain,
        publicProfileUrl: record.public_profile_url,
        programs: record.programs_mentioned ?? [],
        peCodesMentioned: peCode ? [peCode] : [],
        metadata: {
          suffix: record.suffix,
          honorific: record.honorific,
          rank: record.rank,
          subOrganization: record.sub_organization,
          dutyStation: record.duty_station,
          functionalArea: record.functional_area,
          linkType: record.link_type,
          peAccountTitle: record.pe_account_title,
          peOrgCode: record.pe_org_code,
          budgetActivityTitle: record.budget_activity_title,
          peTitle: record.pe_title,
          alignmentConfidence: record.alignment_confidence,
          salesTier: record.sales_tier,
          submissionRelevance: record.submission_relevance,
          decisionAuthority: record.decision_authority,
          whyMatters: record.why_matters_to_capiro,
          subjectMatterArea: record.subject_matter_area,
          sourceSection: record.source_section,
          sourcePage: record.source_page,
          notes: record.notes,
          status: record.status,
        },
      },
      sourceTag,
      sourceUrl,
      record.why_matters_to_capiro,
      observedAt,
      confidence,
    );

    if (result.inserted) {
      stats.persons_inserted += 1;
    }

    if (record.status === 'vacant') {
      stats.vacancies_detected += 1;
      await this.emitVacancyEvent(record, sourceVersion);
    }

    return false;
  }

  private parseSourceVersion(fileName: string): string {
    const normalized = fileName.replace(/\.pdf$/i, '').replace(/\s+/g, '_').toLowerCase();
    const update = normalized.match(/update[_\-]?(\d+)/i)?.[1] ?? 'x';
    const year = normalized.match(/(20\d{2})/)?.[1] ?? String(new Date().getUTCFullYear());
    const month = '01';
    return `dow_directory_update_${update}_${year}_${month}`;
  }

  private parseSourceDate(fileName: string): Date {
    const year = Number.parseInt(fileName.match(/(20\d{2})/)?.[1] ?? '', 10);
    if (Number.isFinite(year)) {
      return new Date(Date.UTC(year, 0, 1, 0, 0, 0));
    }
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  }

  private assembleFullName(record: DowDirectoryPersonRecord): string {
    const left = [record.rank, record.honorific, record.full_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (record.suffix?.trim()) return `${left}, ${record.suffix.trim()}`;
    return left;
  }

  private extractEmailDomain(email?: string): string | undefined {
    if (!email) return undefined;
    const value = email.trim().toLowerCase();
    if (!value) return undefined;
    if (value.includes('@')) return value.split('@')[1] ?? undefined;
    return value;
  }

  private async emitVacancyEvent(record: DowDirectoryPersonRecord, sourceVersion: string): Promise<void> {
    await this.prisma.intelligenceChange.create({
      data: {
        source: 'dow_directory_parser',
        changeType: 'vacancy_detected',
        severity: 'notable',
        title: `Vacancy: ${record.title ?? 'Unknown Role'} (${record.organization ?? 'Unknown Org'})`,
        description: `DoW directory lists vacancy for ${record.title ?? 'position'} in ${record.organization ?? 'unknown organization'} on page ${record.source_page}.`,
        relatedClientIds: [],
        relatedIssues: ['vacancy'],
        relatedPeCodes: record.pe_code ? [record.pe_code] : [],
        data: {
          sourceVersion,
          section: record.source_section,
          page: record.source_page,
          status: record.status,
        },
      },
    });
  }

  private async uploadPdfCacheIfMissing(sourceVersion: string, pdfBuffer: Buffer): Promise<void> {
    const key = `dow-directory/${sourceVersion}.pdf`;
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.s3Bucket, Key: key }));
      return;
    } catch {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
          ServerSideEncryption: 'AES256',
        }),
      );
    }
  }

  private async ensureExtractionCacheTable(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS extraction_cache (
        pdf_sha256 TEXT NOT NULL,
        section_page_start INTEGER NOT NULL,
        section_page_end INTEGER NOT NULL,
        response_jsonb JSONB NOT NULL,
        credits_consumed INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (pdf_sha256, section_page_start, section_page_end)
      );
    `);
  }

  private async getCachedPdfReadUrl(sourceVersion: string): Promise<string> {
    const key = `dow-directory/${sourceVersion}.pdf`;
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.s3Bucket, Key: key }),
      { expiresIn: 3600 },
    );
  }

  private withSectionFragment(baseUrl: string, pageStart: number, pageEnd: number): string {
    return `${baseUrl}#page=${pageStart}&endPage=${pageEnd}`;
  }

  private async getCachedExtraction(
    pdfSha256: string,
    sectionPageStart: number,
    sectionPageEnd: number,
  ): Promise<{ result: DowDirectorySectionExtraction; creditsConsumed: number } | null> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ response_jsonb: unknown; credits_consumed: number }>>(
      `SELECT response_jsonb, credits_consumed
       FROM extraction_cache
       WHERE pdf_sha256 = $1 AND section_page_start = $2 AND section_page_end = $3
       LIMIT 1`,
      pdfSha256,
      sectionPageStart,
      sectionPageEnd,
    );

    const row = rows[0];
    if (!row) return null;
    return {
      result: row.response_jsonb as DowDirectorySectionExtraction,
      creditsConsumed: Number(row.credits_consumed ?? 0),
    };
  }

  private async setCachedExtraction(
    pdfSha256: string,
    sectionPageStart: number,
    sectionPageEnd: number,
    result: DowDirectorySectionExtraction,
    creditsConsumed: number,
  ): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO extraction_cache (pdf_sha256, section_page_start, section_page_end, response_jsonb, credits_consumed)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (pdf_sha256, section_page_start, section_page_end)
       DO UPDATE SET response_jsonb = EXCLUDED.response_jsonb, credits_consumed = EXCLUDED.credits_consumed, updated_at = NOW()`,
      pdfSha256,
      sectionPageStart,
      sectionPageEnd,
      JSON.stringify(result),
      creditsConsumed,
    );
  }
}

class FirecrawlDowDirectoryExtractionClient implements DowDirectoryExtractionClient {
  private readonly apiKey: string;
  private readonly apiRoot: string;

  constructor(apiKey = process.env.FIRECRAWL_API_KEY ?? '', apiRoot = process.env.FIRECRAWL_BASE_URL ?? FIRECRAWL_ROOT) {
    this.apiKey = apiKey;
    this.apiRoot = apiRoot.endsWith('/') ? apiRoot : `${apiRoot}/`;
  }

  async extractSection(params: {
    section: DowDirectorySectionChunk;
    sectionPdf: Buffer;
    sourcePdfPresignedUrl: string;
  }): Promise<{ result: DowDirectorySectionExtraction; creditsConsumed: number }> {
    const { section, sourcePdfPresignedUrl } = params;
    if (!this.apiKey.trim()) throw new Error('FIRECRAWL_API_KEY is required for DoW directory extraction');

    const v2Root = this.apiRoot.replace(/\/v1\/?$/i, '/');
    const endpoint = new URL('v2/scrape', v2Root);
    const body = {
      url: sourcePdfPresignedUrl,
      onlyMainContent: true,
      formats: [
        'markdown',
        {
          type: 'json',
          prompt: `${EXTRACTION_PROMPT}\n\nSection scope: ${section.title} pages ${section.pageStart}-${section.pageEnd}.`,
          schema: PERSONNEL_EXTRACTION_SCHEMA,
        },
      ],
    };

    const response = await fetchJson<{
      success?: boolean;
      data?: {
        json?: DowDirectorySectionExtraction;
        metadata?: { creditsUsed?: number };
      };
      error?: string;
    }>(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      timeoutMs: 240_000,
      secrets: [this.apiKey],
    });

    const parsed = response.data?.json;
    if (!response.success || !parsed) {
      throw new Error(
        `Firecrawl v2/scrape failed for section ${section.title}: ${JSON.stringify(response).slice(0, 1200)}`,
      );
    }

    const credits = Number(response.data?.metadata?.creditsUsed ?? 0);

    return {
      result: parsed,
      creditsConsumed: Number.isFinite(credits) ? credits : 0,
    };
  }
}
