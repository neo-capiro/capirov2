export type GovernmentSource = 'federal_register' | 'congress' | 'lda' | 'govinfo';

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  source: GovernmentSource;
}

export interface SearchOptions {
  limit?: number;
  page?: number;
}

