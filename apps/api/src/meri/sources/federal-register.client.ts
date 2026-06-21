import { fetchJson } from './http.js';
import type { SearchOptions, SearchResult } from './types.js';
import { clampPositiveInt, compactSnippet } from './utils.js';

const FEDERAL_REGISTER_API_ROOT = 'https://www.federalregister.gov/api/v1/';

export interface FederalRegisterAgency {
  id?: number;
  name?: string;
  raw_name?: string;
  slug?: string;
  url?: string;
  json_url?: string;
}

export interface FederalRegisterDocument {
  title: string;
  type?: string;
  abstract?: string | null;
  document_number: string;
  html_url?: string | null;
  pdf_url?: string | null;
  public_inspection_pdf_url?: string | null;
  publication_date?: string | null;
  agencies?: FederalRegisterAgency[];
  excerpts?: string | null;
  [key: string]: unknown;
}

export interface FederalRegisterSearchOptions extends SearchOptions {
  order?: 'newest' | 'oldest' | 'relevance';
  agencyId?: number;
  documentType?: string;
  publicationDateGte?: string;
  publicationDateLte?: string;
}

interface FederalRegisterSearchResponse {
  results?: FederalRegisterDocument[];
}

export class FederalRegisterClient {
  async search(query: string, opts: FederalRegisterSearchOptions = {}): Promise<SearchResult[]> {
    const url = federalRegisterUrl('documents.json');
    url.searchParams.set('conditions[term]', query.trim());
    url.searchParams.set('per_page', String(clampPositiveInt(opts.limit, 20, 100)));
    url.searchParams.set('page', String(clampPositiveInt(opts.page, 1, 1000)));
    if (opts.order) url.searchParams.set('order', opts.order);
    if (opts.agencyId !== undefined) url.searchParams.set('conditions[agency_ids][]', String(opts.agencyId));
    if (opts.documentType) url.searchParams.set('conditions[type][]', opts.documentType);
    if (opts.publicationDateGte) {
      url.searchParams.set('conditions[publication_date][gte]', opts.publicationDateGte);
    }
    if (opts.publicationDateLte) {
      url.searchParams.set('conditions[publication_date][lte]', opts.publicationDateLte);
    }

    const response = await fetchJson<FederalRegisterSearchResponse>(url);
    return (response.results ?? []).map(federalRegisterDocumentToSearchResult);
  }

  async getDocument(docNumber: string): Promise<FederalRegisterDocument> {
    return fetchJson<FederalRegisterDocument>(federalRegisterUrl(`documents/${encodeURIComponent(docNumber.trim())}.json`));
  }
}

function federalRegisterUrl(path: string): URL {
  return new URL(path, FEDERAL_REGISTER_API_ROOT);
}

function federalRegisterDocumentToSearchResult(document: FederalRegisterDocument): SearchResult {
  const url =
    document.html_url ??
    document.pdf_url ??
    document.public_inspection_pdf_url ??
    `https://www.federalregister.gov/documents/${document.document_number}`;

  return {
    id: document.document_number,
    title: document.title,
    url,
    snippet: compactSnippet([
      document.abstract,
      document.excerpts,
      document.type,
      document.agencies?.map((agency) => agency.name ?? agency.raw_name).filter(Boolean).join(', '),
    ]),
    publishedAt: document.publication_date ?? null,
    source: 'federal_register',
  };
}

