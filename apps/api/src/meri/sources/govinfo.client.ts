import { fetchJson } from './http.js';
import type { SearchOptions, SearchResult } from './types.js';
import { clampPositiveInt, compactSnippet, requireApiKey } from './utils.js';

const GOVINFO_API_ROOT = 'https://api.govinfo.gov/';

export interface GovInfoDownloadLinks {
  txtLink?: string;
  htmLink?: string;
  xmlLink?: string;
  pdfLink?: string;
  modsLink?: string;
  premisLink?: string;
  zipLink?: string;
}

export interface GovInfoSearchItem {
  title: string;
  packageId?: string;
  granuleId?: string;
  collectionCode?: string;
  collectionName?: string;
  dateIssued?: string;
  lastModified?: string;
  governmentAuthor?: string[];
  resultLink?: string;
  relatedLink?: string;
  download?: GovInfoDownloadLinks;
  [key: string]: unknown;
}

export interface GovInfoPackage {
  packageId: string;
  title?: string;
  collectionCode?: string;
  collectionName?: string;
  dateIssued?: string;
  lastModified?: string;
  detailsLink?: string;
  download?: GovInfoDownloadLinks;
  [key: string]: unknown;
}

export interface GovInfoSearchOptions extends SearchOptions {
  offsetMark?: string;
  collections?: string[];
  congress?: number;
  docClass?: string;
  dateIssuedStartDate?: string;
  dateIssuedEndDate?: string;
  sortField?: string;
  sortOrder?: 'ASC' | 'DESC';
}

interface GovInfoSearchResponse {
  results?: GovInfoSearchItem[];
}

interface GovInfoSearchRequest {
  query: string;
  pageSize: number;
  offsetMark: string;
  sorts: Array<{ field: string; sortOrder: 'ASC' | 'DESC' }>;
  collection?: string;
  congress?: number;
  docClass?: string;
  dateIssuedStartDate?: string;
  dateIssuedEndDate?: string;
}

export class GovInfoClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = requireApiKey(apiKey, 'GOVINFO_API_KEY');
  }

  async search(query: string, opts: GovInfoSearchOptions = {}): Promise<SearchResult[]> {
    return this.searchCollections(query, opts);
  }

  async searchCollections(query: string, opts: GovInfoSearchOptions = {}): Promise<SearchResult[]> {
    const body: GovInfoSearchRequest = {
      query: buildGovInfoQuery(query, opts),
      pageSize: clampPositiveInt(opts.limit, 20, 100),
      offsetMark: opts.offsetMark ?? '*',
      sorts: [{ field: opts.sortField ?? 'score', sortOrder: opts.sortOrder ?? 'DESC' }],
    };
    if (opts.collections?.length === 1) body.collection = opts.collections[0];
    if (opts.congress !== undefined) body.congress = opts.congress;
    if (opts.docClass) body.docClass = opts.docClass;
    if (opts.dateIssuedStartDate) body.dateIssuedStartDate = opts.dateIssuedStartDate;
    if (opts.dateIssuedEndDate) body.dateIssuedEndDate = opts.dateIssuedEndDate;

    const response = await fetchJson<GovInfoSearchResponse>(this.url('search'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      secrets: [this.apiKey],
    });

    return (response.results ?? []).map(govInfoItemToSearchResult);
  }

  async getPackage(packageId: string): Promise<GovInfoPackage> {
    return fetchJson<GovInfoPackage>(this.url(`packages/${encodeURIComponent(packageId.trim())}/summary`), {
      secrets: [this.apiKey],
    });
  }

  private url(path: string): URL {
    const url = new URL(path, GOVINFO_API_ROOT);
    url.searchParams.set('api_key', this.apiKey);
    return url;
  }
}

function govInfoItemToSearchResult(item: GovInfoSearchItem): SearchResult {
  const id = item.granuleId ?? item.packageId ?? item.resultLink ?? item.title;

  return {
    id,
    title: item.title,
    url: item.resultLink ?? item.download?.pdfLink ?? govInfoDetailsUrl(item.packageId),
    snippet: compactSnippet([
      item.collectionName ?? item.collectionCode,
      item.governmentAuthor?.join(', '),
      item.dateIssued ? `Issued ${item.dateIssued}` : null,
    ]),
    publishedAt: item.dateIssued ?? item.lastModified ?? null,
    source: 'govinfo',
  };
}

function buildGovInfoQuery(query: string, opts: GovInfoSearchOptions): string {
  const collectionFilter =
    opts.collections && opts.collections.length > 1
      ? `(${opts.collections.map((collection) => `collection:${collection}`).join(' OR ')})`
      : null;

  return [query.trim(), collectionFilter].filter(Boolean).join(' ').trim();
}

function govInfoDetailsUrl(packageId: string | undefined): string {
  return packageId ? `https://www.govinfo.gov/app/details/${packageId}` : 'https://www.govinfo.gov/';
}

