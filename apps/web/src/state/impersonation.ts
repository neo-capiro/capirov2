import { useEffect, useState } from 'react';

/**
 * Capiro Admin "act as tenant X" state. Persisted in sessionStorage so the
 * impersonation survives page reloads but not browser restart. The slug is
 * what gets attached as `x-capiro-impersonate-tenant` to API requests.
 *
 * The server-side enforcement is in TenantContextMiddleware: only callers
 * whose role is capiro_admin can use this header; every use is audit-logged.
 */
const KEY = 'capiro:impersonate-tenant-slug';

interface ImpersonationState {
  actAsTenantSlug: string | null;
  start: (slug: string) => void;
  end: () => void;
}

let listeners: Array<() => void> = [];
function notify() {
  for (const l of listeners) l();
}

function read(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(KEY);
}

function write(slug: string | null) {
  if (slug) window.sessionStorage.setItem(KEY, slug);
  else window.sessionStorage.removeItem(KEY);
  notify();
}

export function useImpersonation(): ImpersonationState {
  const [actAs, setActAs] = useState<string | null>(read());
  useEffect(() => {
    const l = () => setActAs(read());
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);
  return {
    actAsTenantSlug: actAs,
    start: (slug) => write(slug),
    end: () => write(null),
  };
}
