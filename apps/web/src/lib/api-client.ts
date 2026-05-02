import axios, { type AxiosInstance } from 'axios';
import { config } from '../env.js';

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
    if (actAsTenantSlug) {
      req.headers = req.headers ?? {};
      req.headers['x-capiro-impersonate-tenant'] = actAsTenantSlug;
    }
    return req;
  });
  return instance;
}
