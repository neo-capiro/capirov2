import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import { getPrograms } from './programs-api.js';
import type { ProgramSearchResponse } from './programs-api.js';

/**
 * Step 2.1 (#6) — reusable program-alias search hook backed by GET /api/programs?q=.
 *
 * This is the building block for wiring Program as an explorer search source. The
 * DataExplorerPage aggregator (apps/web/src/pages/explorer/DataExplorerPage.tsx) is a
 * tab-registry of `/api/explorer/*` endpoints (each with its own facets + ExplorerResponse
 * shape + table panel); the program API is a different shape (/api/programs). Adding a full
 * "Programs" explorer tab requires a new backend /api/explorer/programs endpoint + facets +
 * a panel component, which was out of scope here and deferred to avoid destabilizing the
 * existing finder. Consumers (the finder, a future explorer tab, or a typeahead) can use
 * this hook directly today. Disabled until a non-empty query is supplied.
 */
export function useProgramSearch(q: string, limit = 25, enabled = true) {
  const api = useApi();
  const query = q.trim();
  return useQuery<ProgramSearchResponse>({
    queryKey: ['program-search', query, limit],
    queryFn: () => getPrograms(api, query, limit),
    enabled: enabled && query.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
