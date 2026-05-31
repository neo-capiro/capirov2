import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GovInfoService } from '../../external/govinfo/govinfo.service.js';

/**
 * Bill text PE-code extractor (Step 21).
 *
 * Scans each CongressBill's text (title + summary-ish fields + latest action +
 * cached/fetched full text from GovInfo) for Program Element codes, filters to
 * PEs that actually exist in program_element, and upserts the set onto the bill.
 * Emits an IntelligenceChange only when the set changed AND a newly-added PE is
 * watched by some tenant.
 */

// PE codes embedded in legislative text: 7 digits starting 0 or 1, then a service
// letter, word-bounded so we don't catch longer numeric runs.
// NOTE: the Step-21 spec wrote /\b[01]\d{2}\d{3}[A-Z]\b/ but that is only 6 digits
// and matches no real PE code (which are 7 digits + letter, e.g. 0603270A). Using
// the 7-digit form so the documented test cases ("0603270A", "0603250F") pass and
// it agrees with the canonical PE_CODE_REGEX in jbook-extract.ts.
const BILL_PE_REGEX = /\b[01]\d{6}[A-Z]\b/g;

/** Extract candidate PE codes from free text: regex, dedupe, uppercase. */
export function extractPeCodes(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.toUpperCase().matchAll(BILL_PE_REGEX)) {
    out.add(m[0]);
  }
  return Array.from(out);
}

export interface BillForExtraction {
  id: string;
  congress: number;
  billType: string;
  billNumber: string;
  title: string | null;
  latestActionText: string | null;
  // Optional extra summary-ish text some callers may carry.
  summary?: string | null;
  peCodes: string[];
}

export interface ProcessResult {
  billId: string;
  peCodes: string[];
  changed: boolean;
  emitted: boolean;
}

@Injectable()
export class BillPeExtractorService {
  private readonly logger = new Logger(BillPeExtractorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly govInfo: GovInfoService,
  ) {}

  /** Process every CongressBill. Returns per-bill results. */
  async run(opts: { fetchFullText?: boolean } = {}): Promise<ProcessResult[]> {
    const bills = await this.prisma.congressBill.findMany({
      select: {
        id: true,
        congress: true,
        billType: true,
        billNumber: true,
        title: true,
        latestActionText: true,
        peCodes: true,
      },
    });

    const results: ProcessResult[] = [];
    for (const bill of bills) {
      try {
        results.push(await this.processBill(bill, opts));
      } catch (err) {
        this.logger.warn(`Bill ${bill.id} extraction failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return results;
  }

  /**
   * Extract + persist PE codes for a single bill.
   *
   * fetchFullText (default true): when set, pull and cache the bill's full text
   * from GovInfo (bill_text table) and include it in the scan. The scan always
   * includes the bill's local metadata fields regardless.
   */
  async processBill(bill: BillForExtraction, opts: { fetchFullText?: boolean } = {}): Promise<ProcessResult> {
    const fetchFullText = opts.fetchFullText ?? true;

    const parts: string[] = [bill.title ?? '', bill.summary ?? '', bill.latestActionText ?? ''];
    if (fetchFullText) {
      const fullText = await this.ensureFullText(bill);
      if (fullText) parts.push(fullText);
    }

    const candidates = extractPeCodes(parts.join('\n'));
    const filtered = await this.filterToExisting(candidates);
    const next = filtered.slice().sort();
    const prev = (bill.peCodes ?? []).slice().sort();
    const changed = !this.sameSet(prev, next);

    if (!changed) {
      return { billId: bill.id, peCodes: next, changed: false, emitted: false };
    }

    await this.prisma.congressBill.update({
      where: { id: bill.id },
      data: { peCodes: next },
    });

    const added = next.filter((c) => !prev.includes(c));
    const emitted = await this.maybeEmit(bill, added, next);
    return { billId: bill.id, peCodes: next, changed: true, emitted };
  }

  /** Keep only candidate codes that exist in program_element. */
  private async filterToExisting(candidates: string[]): Promise<string[]> {
    if (candidates.length === 0) return [];
    const rows = await this.prisma.programElement.findMany({
      where: { peCode: { in: candidates } },
      select: { peCode: true },
    });
    const existing = new Set(rows.map((r) => r.peCode));
    return candidates.filter((c) => existing.has(c));
  }

  /**
   * Return cached full text from bill_text, or fetch it from GovInfo and cache it.
   * Returns null when no full text is available (the extractor then relies on the
   * bill's local metadata fields only).
   */
  private async ensureFullText(bill: BillForExtraction): Promise<string | null> {
    const cached = await this.prisma.billText.findUnique({ where: { billId: bill.id } });
    if (cached) return cached.textContent;

    const packageId = this.govInfoPackageId(bill);
    if (!packageId) return null;

    try {
      const { xml } = await this.govInfo.getBillText(packageId);
      if (!xml) return null;
      await this.prisma.billText.upsert({
        where: { billId: bill.id },
        create: {
          billId: bill.id,
          sourceUrl: `https://www.govinfo.gov/app/details/${packageId}`,
          textContent: xml,
        },
        update: { textContent: xml, fetchedAt: new Date() },
      });
      return xml;
    } catch (err) {
      this.logger.debug(`No GovInfo full text for ${bill.id} (${packageId}): ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Build a GovInfo BILLS package id from a bill's identity. GovInfo package ids
   * carry a version suffix (e.g. BILLS-118hr3935ih) that CongressBill does not
   * store; we request the introduced ("ih"/"is") print, which is the version
   * present for essentially every bill. Returns null when identity is incomplete.
   */
  private govInfoPackageId(bill: BillForExtraction): string | null {
    if (!bill.congress || !bill.billType || !bill.billNumber) return null;
    const chamberVersion = bill.billType.toLowerCase().startsWith('s') ? 'is' : 'ih';
    return `BILLS-${bill.congress}${bill.billType.toLowerCase()}${bill.billNumber}${chamberVersion}`;
  }

  /**
   * Emit one IntelligenceChange per affected tenant when a newly-added PE is
   * watched. No watched new PE → no emission (set may still have changed).
   */
  private async maybeEmit(bill: BillForExtraction, addedPeCodes: string[], allPeCodes: string[]): Promise<boolean> {
    if (addedPeCodes.length === 0) return false;

    const watches = await this.prisma.programElementWatch.findMany({
      where: { peCode: { in: addedPeCodes } },
      select: { tenantId: true, peCode: true },
    });
    if (watches.length === 0) return false;

    const watchedAdded = Array.from(new Set(watches.map((w) => w.peCode)));
    const byTenant = new Map<string, Set<string>>();
    for (const w of watches) {
      const set = byTenant.get(w.tenantId) ?? new Set<string>();
      set.add(w.peCode);
      byTenant.set(w.tenantId, set);
    }

    const billRef = `${bill.billType.toUpperCase()} ${bill.billNumber} (${bill.congress}th)`;
    await Promise.all(
      Array.from(byTenant.entries()).map(([tenantId, peCodes]) =>
        this.prisma.intelligenceChange
          .create({
            data: {
              source: 'congress_bill',
              changeType: 'bill_pe_linked',
              severity: 'notable',
              title: `${billRef} references a watched Program Element`,
              description: `${bill.title ?? billRef} now references ${Array.from(peCodes).join(', ')}.`,
              relatedClientIds: [],
              relatedIssues: [],
              relatedPeCodes: Array.from(peCodes),
              data: { billId: bill.id, addedPeCodes: watchedAdded, allPeCodes },
            },
          })
          .catch((err: unknown) => {
            this.logger.warn(`Failed to emit bill PE change for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
          }),
      ),
    );
    return true;
  }

  private sameSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
}
