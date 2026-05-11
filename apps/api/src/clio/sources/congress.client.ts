import { fetchJson } from './http.js';
import type { SearchOptions, SearchResult } from './types.js';
import { clampPositiveInt, compactSnippet, requireApiKey } from './utils.js';

const CONGRESS_API_ROOT = 'https://api.congress.gov/v3/';

export interface CongressLatestAction {
  actionDate?: string;
  actionTime?: string;
  text?: string;
}

export interface CongressBill {
  congress: number;
  type: string;
  number: string;
  title: string;
  url?: string;
  legislationUrl?: string;
  originChamber?: string;
  originChamberCode?: string;
  introducedDate?: string;
  updateDate?: string;
  updateDateIncludingText?: string;
  latestAction?: CongressLatestAction;
  policyArea?: { name?: string };
  sponsors?: Array<{ fullName?: string; bioguideId?: string; party?: string; state?: string }>;
  [key: string]: unknown;
}

export interface CongressMember {
  bioguideId: string;
  directOrderName?: string;
  invertedOrderName?: string;
  firstName?: string;
  lastName?: string;
  currentMember?: boolean;
  state?: string;
  district?: number;
  officialWebsiteUrl?: string;
  [key: string]: unknown;
}

export interface CongressSearchOptions extends SearchOptions {
  congress?: number;
  offset?: number;
  requestLimit?: number;
  billType?: string;
}

interface CongressBillListResponse {
  bills?: CongressBill[];
}

interface CongressBillResponse {
  bill: CongressBill;
}

interface CongressMemberResponse {
  member: CongressMember;
}

export class CongressClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = requireApiKey(apiKey, 'CONGRESS_API_KEY');
  }

  async search(query: string, opts: CongressSearchOptions = {}): Promise<SearchResult[]> {
    return this.searchBills(query, opts.congress ?? currentCongress(), opts);
  }

  async searchBills(query: string, congress: number, opts: CongressSearchOptions = {}): Promise<SearchResult[]> {
    const limit = clampPositiveInt(opts.limit, 20, 250);
    const requestLimit = clampPositiveInt(opts.requestLimit ?? Math.max(limit, 100), 100, 250);
    const path = opts.billType
      ? `bill/${congress}/${encodeURIComponent(opts.billType.toLowerCase())}`
      : `bill/${congress}`;
    const url = this.url(path);
    url.searchParams.set('limit', String(requestLimit));
    if (opts.offset !== undefined) url.searchParams.set('offset', String(Math.max(0, Math.trunc(opts.offset))));

    const response = await fetchJson<CongressBillListResponse>(url, { secrets: [this.apiKey] });
    const normalizedQuery = query.trim().toLowerCase();
    const bills = response.bills ?? [];
    const matches = normalizedQuery ? bills.filter((bill) => billMatchesQuery(bill, normalizedQuery)) : bills;
    return matches.slice(0, limit).map(congressBillToSearchResult);
  }

  async getBill(congress: number, type: string, number: string | number): Promise<CongressBill> {
    const url = this.url(
      `bill/${congress}/${encodeURIComponent(type.toLowerCase())}/${encodeURIComponent(String(number))}`,
    );
    const response = await fetchJson<CongressBillResponse>(url, { secrets: [this.apiKey] });
    return response.bill;
  }

  async getMember(bioguideId: string): Promise<CongressMember> {
    const url = this.url(`member/${encodeURIComponent(bioguideId.trim())}`);
    const response = await fetchJson<CongressMemberResponse>(url, { secrets: [this.apiKey] });
    return response.member;
  }

  private url(path: string): URL {
    const url = new URL(path, CONGRESS_API_ROOT);
    url.searchParams.set('format', 'json');
    url.searchParams.set('api_key', this.apiKey);
    return url;
  }
}

function congressBillToSearchResult(bill: CongressBill): SearchResult {
  return {
    id: `${bill.congress}-${bill.type}-${bill.number}`.toLowerCase(),
    title: bill.title,
    url: bill.legislationUrl ?? congressGovBillUrl(bill) ?? bill.url ?? '',
    snippet: compactSnippet([
      bill.latestAction?.text,
      bill.policyArea?.name,
      bill.sponsors?.map((sponsor) => sponsor.fullName).filter(Boolean).join(', '),
    ]),
    publishedAt: bill.latestAction?.actionDate ?? bill.updateDateIncludingText ?? bill.updateDate ?? null,
    source: 'congress',
  };
}

function billMatchesQuery(bill: CongressBill, normalizedQuery: string): boolean {
  return [
    bill.title,
    bill.latestAction?.text,
    bill.policyArea?.name,
    bill.number,
    bill.type,
    bill.sponsors?.map((sponsor) => sponsor.fullName).join(' '),
  ]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

function congressGovBillUrl(bill: CongressBill): string | null {
  const typeSlug = billTypeSlug(bill.type);
  if (!typeSlug) return null;
  return `https://www.congress.gov/bill/${ordinal(bill.congress)}-congress/${typeSlug}/${bill.number}`;
}

function billTypeSlug(type: string): string | null {
  const normalized = type.toLowerCase();
  const slugs: Record<string, string> = {
    hr: 'house-bill',
    s: 'senate-bill',
    hjres: 'house-joint-resolution',
    sjres: 'senate-joint-resolution',
    hconres: 'house-concurrent-resolution',
    sconres: 'senate-concurrent-resolution',
    hres: 'house-resolution',
    sres: 'senate-resolution',
  };

  return slugs[normalized] ?? null;
}

function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function currentCongress(date = new Date()): number {
  return Math.floor((date.getUTCFullYear() - 1789) / 2) + 1;
}

