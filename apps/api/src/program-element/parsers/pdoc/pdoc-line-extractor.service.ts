import { Injectable } from '@nestjs/common';
import { parseNum, type ProcurementLineItem } from './pdoc-parser.service.js';

/**
 * Extracts/normalizes child procurement line items (kit codes, sub-quantities)
 * from raw extracted P-Doc line rows. Kept separate from PDocParserService so the
 * child-hierarchy logic can evolve independently (P-Doc layouts vary by Service).
 */
@Injectable()
export class PDocLineExtractorService {
  /**
   * Normalize raw line rows into typed ProcurementLineItem[]. Drops rows without
   * a description (not a real sub-line). FY defaults to the book's FY when absent.
   */
  extract(rawLines: Array<Record<string, unknown>> | null | undefined, defaultFy: number): ProcurementLineItem[] {
    if (!rawLines) return [];
    return rawLines
      .map((li) => ({
        description: String(li.description ?? '').trim(),
        fy: Number(li.fy ?? defaultFy),
        quantity: parseNum((li.quantity ?? null) as never),
        dollars: parseNum((li.dollars ?? null) as never),
        unitCost: parseNum((li.unitCost ?? li.unit_cost ?? null) as never),
      }))
      .filter((li) => li.description.length > 0 && Number.isFinite(li.fy));
  }
}
