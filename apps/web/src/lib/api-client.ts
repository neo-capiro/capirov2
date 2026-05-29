import axios, { type AxiosInstance } from 'axios';
import { config } from '../env.js';
import { clearImpersonationSlug } from '../state/impersonation.js';

/**
 * Build an axios instance bound to the Clerk getToken() callback. The token
 * uses the `capiro` JWT template so requests carry capiro_tenant_id /
 * capiro_tenant_slug claims. Pass an optional `actAsTenantSlug` to attach
 * the impersonation header (only honored server-side for capiro_admin).
 */
export function buildApiClient(
  getToken: () => Promise<string | null>,
  actAsTenantSlug?: string,
): AxiosInstance {
  const instance = axios.create({
    baseURL: config.apiBaseUrl,
    timeout: 20_000,
  });
  instance.interceptors.request.use(async (req) => {
    const token = await getToken();
    if (token) {
      req.headers = req.headers ?? {};
      req.headers.Authorization = `Bearer ${token}`;
    }
    // Never attach the impersonation header to the Capiro Admin console itself
    // (tenant list, start/end impersonation). Those must always run as the
    // admin's real context; otherwise a stale slug 403s the very requests
    // needed to start or end impersonation, locking the admin out.
    const url = req.url ?? '';
    const isAdminConsole = url.includes('/capiro-admin/');
    if (actAsTenantSlug && !isAdminConsole) {
      req.headers = req.headers ?? {};
      req.headers['x-capiro-impersonate-tenant'] = actAsTenantSlug;
    }
    return req;
  });
  // If the server reports the impersonation session is gone (expired/ended),
  // drop the stale slug and reload so the app falls back to the real context
  // instead of 403-looping every request.
  instance.interceptors.response.use(
    (res) => res,
    (error) => {
      const status = error?.response?.status;
      const msg = String(error?.response?.data?.message ?? '');
      if (status === 403 && /impersonation session/i.test(msg)) {
        clearImpersonationSlug();
        if (typeof window !== 'undefined') window.location.reload();
      }
      return Promise.reject(error);
    },
  );
  return instance;
}
