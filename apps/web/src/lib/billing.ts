import { useMutation, useQuery } from '@tanstack/react-query';
import type { BillingSummary } from '@capiro/shared';
import { useApi } from './use-api.js';

/**
 * Current tenant billing posture (plan, slots, LLM usage). Gated server-side to
 * user_admin+, so for standard users the query 403s — callers treat an error as
 * "unknown / don't block" (fail open). retry:false keeps the paywall gate snappy.
 */
export function useBilling() {
  const api = useApi();
  return useQuery<BillingSummary>({
    queryKey: ['billing', 'summary'],
    queryFn: async () => (await api.get<BillingSummary>('/api/billing/summary')).data,
    staleTime: 30_000,
    retry: false,
  });
}

/** Open Stripe Checkout for `quantity` slots (+ optional promo). Redirects on success. */
export function useCheckout() {
  const api = useApi();
  return useMutation({
    mutationFn: async (input: { quantity: number; promoCode?: string }) => {
      const { url } = (await api.post<{ url: string }>('/api/billing/checkout', input)).data;
      return url;
    },
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });
}

/** Open the Stripe Customer Portal (manage payment, change slots, invoices). */
export function usePortal() {
  const api = useApi();
  return useMutation({
    mutationFn: async () => {
      const { url } = (await api.post<{ url: string }>('/api/billing/portal', {})).data;
      return url;
    },
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });
}
