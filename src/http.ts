// Internal fetch wrapper + retry engine. Not part of the public API.
import { ApiError, RateLimitError, SimpleQConnectionError, SimpleQError, mapApiError } from './errors.js';

export interface HttpClientOptions {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  userAgent: string;
}

export interface RequestOptions {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Retry transient failures (network / 5xx / 429). Default true. */
  retry?: boolean;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Exponential backoff (base 250ms, cap 8s) with full jitter.
function backoffMs(attempt: number): number {
  const ceiling = Math.min(250 * 2 ** attempt, 8000);
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
}

export class HttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  async request<T>(req: RequestOptions): Promise<T> {
    const maxAttempts = (req.retry ?? true) ? this.opts.maxRetries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.attempt<T>(req);
      } catch (err) {
        lastError = err;
        if (!this.isRetryable(err) || attempt === maxAttempts - 1) throw err;
        await sleep(this.retryAfterMs(err) ?? backoffMs(attempt));
      }
    }
    // Unreachable in practice — the loop either returns or throws.
    throw lastError instanceof Error ? lastError : new SimpleQError(String(lastError));
  }

  private async attempt<T>(req: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeout);
    let res: Response;
    try {
      res = await this.opts.fetchImpl(this.opts.baseUrl + req.path, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': this.opts.userAgent,
          ...req.headers,
        },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new SimpleQConnectionError(
        `Request to ${req.method} ${req.path} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw mapApiError(res.status, await this.parseBody(res), res.headers);
    if (res.status === 204) return undefined as T;
    return (await this.parseBody(res)) as T;
  }

  private async parseBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof SimpleQConnectionError) return true;
    if (err instanceof ApiError) return RETRYABLE_STATUS.has(err.status);
    return false;
  }

  private retryAfterMs(err: unknown): number | undefined {
    return err instanceof RateLimitError && typeof err.retryAfter === 'number'
      ? err.retryAfter * 1000
      : undefined;
  }
}
