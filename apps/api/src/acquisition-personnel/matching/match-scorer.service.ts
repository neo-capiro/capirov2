import { Injectable } from '@nestjs/common';
import { MatchResult, PersonRecordInput } from '../types.js';

@Injectable()
export class MatchScorerService {
  async findMatches(candidate: {
    fullName: string;
    organization?: string;
    title?: string;
    emailDomain?: string;
    programs?: string[];
    peCodesMentioned?: string[];
  }): Promise<MatchResult[]> {
    void candidate;
    return [];
  }

  jaccardOverlap(setA: Iterable<string>, setB: Iterable<string>): number {
    const a = new Set(Array.from(setA).map((v) => v.toLowerCase().trim()).filter(Boolean));
    const b = new Set(Array.from(setB).map((v) => v.toLowerCase().trim()).filter(Boolean));
    if (a.size === 0 || b.size === 0) return 0;
    const aVals = Array.from(a);
    const bVals = Array.from(b);
    const intersection = new Set(aVals.filter((x) => b.has(x))).size;
    const union = new Set([...aVals, ...bVals]).size;
    return union === 0 ? 0 : intersection / union;
  }

  async pgTrgmSimilarity(a: string, b: string): Promise<number> {
    void a;
    void b;
    return 0;
  }
}
