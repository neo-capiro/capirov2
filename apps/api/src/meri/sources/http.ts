const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 100;

export interface FetchJsonOptions extends RequestInit {
  secrets?: string[];
  timeoutMs?: number;
}

export class SourceClientError extends Error {
  readonly status?: number;
  readonly url: string;
  // Error.cause exists at runtime (ES2022) but isn't in this project's TS lib,
  // so declare it explicitly to type the assignment below.
  cause?: unknown;

  constructor(message: string, input: { status?: number; url: string; cause?: unknown }) {
    super(message);
    this.name = 'SourceClientError';
    this.status = input.status;
    this.url = input.url;
    if (input.cause !== undefined) this.cause = input.cause;
  }
}

export async function fetchJson<T>(url: URL | string, options: FetchJsonOptions = {}): Promise<T> {
  const { secrets = [], timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const target = url.toString();
  const redactedUrl = redactSecrets(target, secrets);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(target, init, timeoutMs);

      if (response.ok) return await parseJson<T>(response, redactedUrl, secrets);

      const body = await response.text().catch(() => '');
      if (isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }

      throw new SourceClientError(formatHttpError(response, redactedUrl, body, secrets), {
        status: response.status,
        url: redactedUrl,
      });
    } catch (error) {
      if (error instanceof SourceClientError) throw error;

      if (isAbortError(error)) {
        throw new SourceClientError(`Source request timed out after ${timeoutMs}ms for ${redactedUrl}`, {
          url: redactedUrl,
          cause: error,
        });
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(retryDelayMs(null, attempt));
        continue;
      }

      throw new SourceClientError(`Source request failed for ${redactedUrl}: ${redactSecrets(errorMessage(error), secrets)}`, {
        url: redactedUrl,
        cause: error,
      });
    }
  }

  throw new SourceClientError(`Source request failed for ${redactedUrl}`, { url: redactedUrl });
}

export function redactSecrets(value: string, secrets: string[] = []): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('[REDACTED]');
  }

  return redacted.replace(/([?&](?:api_key|apiKey|key)=)[^&\s"']+/gi, '$1[REDACTED]');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const { signal: _signal, ...rest } = init;

  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort();
    upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
  }

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}

async function parseJson<T>(response: Response, redactedUrl: string, secrets: string[]): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new SourceClientError(`Source returned invalid JSON for ${redactedUrl}: ${redactSecrets(errorMessage(error), secrets)}`, {
      status: response.status,
      url: redactedUrl,
      cause: error,
    });
  }
}

function formatHttpError(response: Response, redactedUrl: string, body: string, secrets: string[]): string {
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  const bodyText = compactBody(body);
  const suffix = bodyText ? `: ${redactSecrets(bodyText, secrets)}` : '';
  return `Source request failed with status ${response.status}${statusText} for ${redactedUrl}${suffix}`;
}

function compactBody(body: string): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized;
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }

  return BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

