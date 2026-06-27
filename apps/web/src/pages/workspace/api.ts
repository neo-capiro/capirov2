import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import type {
  WsComment,
  WsConfig,
  WsContextItem,
  WsDocument,
  WsDraft,
  WsProductDefaults,
  WsTemplate,
} from './types.js';

// Base path: the engine is mounted at /workspace-api/* on the shared ALB.
const BASE = '/workspace-api';

// ── Cascade + catalog ───────────────────────────────────────────────────────
export function useIndustries() {
  const api = useApi();
  return useQuery({
    queryKey: ['ws', 'industries'],
    queryFn: async () => (await api.get<{ industries: string[] }>(`${BASE}/cascade`)).data.industries,
  });
}

export function useProductsFor(industry: string | null, all = false) {
  const api = useApi();
  return useQuery({
    queryKey: ['ws', 'products', industry, all],
    enabled: all || !!industry,
    queryFn: async () => {
      const ind = encodeURIComponent(industry ?? 'Defense & Aerospace');
      const { data } = await api.get<{ products: string[] }>(
        `${BASE}/cascade/${ind}/products${all ? '?all=1' : ''}`,
      );
      return data.products;
    },
  });
}

export function usePathwaysFor(industry: string | null, product: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['ws', 'pathways', industry, product],
    enabled: !!industry && !!product,
    queryFn: async () => {
      const { data } = await api.get<{ pathways: string[] }>(
        `${BASE}/cascade/${encodeURIComponent(industry!)}/products/${encodeURIComponent(product!)}/pathways`,
      );
      return data.pathways;
    },
  });
}

export function useCommitteesFor(industry: string | null, pathways: string[]) {
  const api = useApi();
  return useQuery({
    queryKey: ['ws', 'committees', industry, pathways],
    enabled: !!industry && pathways.length > 0,
    queryFn: async () => {
      const { data } = await api.get<{ committees: string[] }>(
        `${BASE}/cascade/${encodeURIComponent(industry!)}/committees?pathways=${encodeURIComponent(pathways.join(','))}`,
      );
      return data.committees;
    },
  });
}

export function useProductDefaults(product: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['ws', 'defaults', product],
    enabled: !!product,
    queryFn: async () =>
      (await api.get<WsProductDefaults>(`${BASE}/products/${encodeURIComponent(product!)}/defaults`)).data,
  });
}

// ── Templates ───────────────────────────────────────────────────────────────
export function useTemplatesFor(product: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['ws', 'templates', product],
    enabled: !!product,
    queryFn: async () =>
      (
        await api.get<{ primary: WsTemplate | null; secondary: WsTemplate | null; all: WsTemplate[] }>(
          `${BASE}/templates?product=${encodeURIComponent(product!)}`,
        )
      ).data,
  });
}

// ── Drafts ──────────────────────────────────────────────────────────────────
export function useDrafts(params?: { sector?: string; scope?: 'all' | 'mine' | 'shared' }) {
  const api = useApi();
  return useQuery({
    queryKey: ['ws', 'drafts', params],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (params?.sector) q.set('sector', params.sector);
      if (params?.scope) q.set('scope', params.scope);
      const qs = q.toString();
      return (await api.get<WsDraft[]>(`${BASE}/drafts${qs ? `?${qs}` : ''}`)).data;
    },
  });
}

export function useDraft(id: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['ws', 'draft', id],
    enabled: !!id,
    queryFn: async () => (await api.get<WsDraft>(`${BASE}/drafts/${id}`)).data,
  });
}

export function useCreateDraft() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { industry?: string; product?: string; client?: string; docTitle?: string }) =>
      (await api.post<WsDraft>(`${BASE}/drafts`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', 'drafts'] }),
  });
}

export function useUpdateDraft(id: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<{
      docTitle: string;
      industry: string;
      product: string;
      client: string;
      status: 'draft' | 'complete';
      config: Partial<WsConfig>;
      ask: { amount?: string; pb?: string; delta?: string };
    }>) => (await api.patch<WsDraft>(`${BASE}/drafts/${id}`, body)).data,
    onSuccess: (data) => {
      qc.setQueryData(['ws', 'draft', id], data);
      qc.invalidateQueries({ queryKey: ['ws', 'drafts'] });
    },
  });
}

export function useDeleteDraft() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`${BASE}/drafts/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', 'drafts'] }),
  });
}

// ── Documents (packet tabs) ─────────────────────────────────────────────────
export function useAddDocument(draftId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; ordinal?: number }) =>
      (await api.post<WsDocument>(`${BASE}/drafts/${draftId}/documents`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', 'draft', draftId] }),
  });
}

export function useUpdateDocument(draftId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ docId, body }: { docId: string; body: Partial<{ name: string; ordinal: number; body: Record<string, unknown> }> }) =>
      (await api.patch<WsDocument>(`${BASE}/drafts/${draftId}/documents/${docId}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', 'draft', draftId] }),
  });
}

export function useDeleteDocument(draftId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (docId: string) =>
      (await api.delete(`${BASE}/drafts/${draftId}/documents/${docId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', 'draft', draftId] }),
  });
}

// ── Comments ────────────────────────────────────────────────────────────────
export function useComments(documentId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['ws', 'comments', documentId],
    enabled: !!documentId,
    queryFn: async () => (await api.get<WsComment[]>(`${BASE}/documents/${documentId}/comments`)).data,
  });
}

export function useCreateComment(documentId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { body: string; quote?: string; anchor?: Record<string, unknown>; parentId?: string }) =>
      (await api.post<WsComment>(`${BASE}/documents/${documentId}/comments`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', 'comments', documentId] }),
  });
}

export function useUpdateComment(documentId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ commentId, body }: { commentId: string; body: Partial<{ body: string; resolved: boolean }> }) =>
      (await api.patch<WsComment>(`${BASE}/documents/${documentId}/comments/${commentId}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', 'comments', documentId] }),
  });
}

// ── Generation (Meri) ───────────────────────────────────────────────────────
export interface GenerateSectionResult {
  section: string;
  content: string;
  model: string;
  usedTenantKey: boolean;
  anonymized: boolean;
  legend?: Record<string, string>;
}

export function useGenerateSection(draftId: string) {
  const api = useApi();
  return useMutation({
    mutationFn: async (section: string) =>
      (
        await api.post<GenerateSectionResult>(`${BASE}/drafts/${draftId}/generate-section`, { section })
      ).data,
  });
}

/** Download the draft as a .docx (engine renders via the docx lib). */
export function useExportDocx(draftId: string) {
  const api = useApi();
  return useMutation({
    mutationFn: async (filenameHint?: string) => {
      const res = await api.get<Blob>(`${BASE}/drafts/${draftId}/export/docx`, {
        responseType: 'blob',
      });
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(filenameHint || 'document').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });
}

// ── Context Builder ─────────────────────────────────────────────────────────
export function useContextSources(client: string | null, offices: string[]) {
  const api = useApi();
  return useQuery({
    queryKey: ['ws', 'ctx-sources', client, offices],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (client) q.set('client', client);
      if (offices.length) q.set('offices', offices.join(','));
      return (await api.get(`${BASE}/context/sources?${q.toString()}`)).data;
    },
  });
}

export function useContextNews(client: string | null, offices: string[]) {
  const api = useApi();
  return useQuery({
    queryKey: ['ws', 'ctx-news', client, offices],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (client) q.set('client', client);
      if (offices.length) q.set('offices', offices.join(','));
      return (await api.get(`${BASE}/context/news?${q.toString()}`)).data;
    },
  });
}

export function useDraftContext(draftId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['ws', 'ctx-items', draftId],
    enabled: !!draftId,
    queryFn: async () => (await api.get<WsContextItem[]>(`${BASE}/drafts/${draftId}/context`)).data,
  });
}

export function useAddContextItem(draftId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { kind: 'source' | 'news' | 'free-text'; payload: Record<string, unknown> }) =>
      (await api.post<WsContextItem>(`${BASE}/drafts/${draftId}/context`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', 'ctx-items', draftId] }),
  });
}

export function useRemoveContextItem(draftId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) =>
      (await api.delete(`${BASE}/drafts/${draftId}/context/${itemId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', 'ctx-items', draftId] }),
  });
}
