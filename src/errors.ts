// Error and signal types for @simpleq/sdk.

/** Base class for everything thrown by the SDK. Catch this to handle any SimpleQ error. */
export class SimpleQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** A network failure, timeout, or aborted request — retryable. */
export class SimpleQConnectionError extends SimpleQError {}

/** Thrown by `verifyWebhook` when a webhook signature does not verify. */
export class SignatureVerificationError extends SimpleQError {}

export type BackpressureStatus = 429 | 503 | 529;

/**
 * A backpressure signal — not a failure. Throw this from a standard-mode webhook handler to
 * tell the adapter to respond with `429`/`503`/`529` and a `Retry-After`. SimpleQ then holds
 * the job and redelivers it without burning a delivery attempt.
 */
export class SimpleQBackpressure extends SimpleQError {
  /** Seconds to hold the job before redelivery. Omit to let SimpleQ pick its fallback. */
  readonly retryAfter?: number;
  /** HTTP status the adapter responds with. Defaults to `503`. */
  readonly status: BackpressureStatus;

  constructor(retryAfter?: number, options?: { status?: BackpressureStatus; reason?: string }) {
    const detail = retryAfter != null ? ` (retry after ${retryAfter}s)` : '';
    super(options?.reason ?? `SimpleQ backpressure${detail}`);
    this.retryAfter = retryAfter;
    this.status = options?.status ?? 503;
  }

  /**
   * Build a backpressure signal directly from a provider error (Anthropic, OpenAI, any
   * HTTP-shaped error). Reads `err.status` (429/503/529 pass through; anything else maps
   * to 503) and the `Retry-After` header in seconds from `err.headers` or
   * `err.response.headers` (plain object or Headers). When no header is present,
   * `options.fallback` seconds is used; with neither, SimpleQ applies its own 60s hold.
   */
  static from(err: unknown, options?: { fallback?: number; reason?: string }): SimpleQBackpressure {
    const e = err as { status?: unknown; message?: unknown } | null | undefined;
    const status: BackpressureStatus =
      e?.status === 429 || e?.status === 503 || e?.status === 529 ? e.status : 503;
    const retryAfter = retryAfterSeconds(err) ?? options?.fallback;
    const reason =
      options?.reason ?? (typeof e?.message === 'string' && e.message ? e.message : undefined);
    return new SimpleQBackpressure(retryAfter, { status, reason });
  }
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, unknown>;
  const value = record[name.toLowerCase()] ?? record['Retry-After'];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Read the `Retry-After` value, in **seconds**, from a provider error (Anthropic, OpenAI, any
 * HTTP-shaped error). Looks at `err.headers` and `err.response.headers` (plain object or a
 * `Headers` instance). Returns `undefined` when the header is absent or non-numeric (e.g. an
 * HTTP-date). Pair with `simpleq.defer` in ack mode: `defer(id, { retryAfter: retryAfterSeconds(err) ?? 10 })`.
 */
export function retryAfterSeconds(err: unknown): number | undefined {
  const e = err as { headers?: unknown; response?: { headers?: unknown } } | null | undefined;
  const raw =
    readHeader(e?.headers, 'retry-after') ?? readHeader(e?.response?.headers, 'retry-after');
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** Any non-2xx response from the SimpleQ API. */
export class ApiError extends SimpleQError {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** `401`/`403` — the API key is missing, invalid, or revoked. */
export class AuthenticationError extends ApiError {}

/** `400` — request validation failed. `body.error` carries the field-level details. */
export class ValidationError extends ApiError {}

/** `404` — the queue or job was not found. */
export class NotFoundError extends ApiError {}

/** `429` — rate limited. `retryAfter` is the `Retry-After` header in seconds, if present. */
export class RateLimitError extends ApiError {
  readonly retryAfter?: number;

  constructor(message: string, status: number, body: unknown, retryAfter?: number) {
    super(message, status, body);
    this.retryAfter = retryAfter;
  }
}

function extractMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') return `Validation failed: ${JSON.stringify(err)}`;
  }
  return `SimpleQ API error (HTTP ${status})`;
}

/** Map an HTTP status + parsed body to the right ApiError subclass. */
export function mapApiError(status: number, body: unknown, headers?: Headers): ApiError {
  const message = extractMessage(status, body);
  switch (status) {
    case 400:
      return new ValidationError(message, status, body);
    case 401:
    case 403:
      return new AuthenticationError(message, status, body);
    case 404:
      return new NotFoundError(message, status, body);
    case 429: {
      const raw = headers?.get('retry-after');
      const retryAfter = raw != null ? Number(raw) : NaN;
      return new RateLimitError(message, status, body, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    default:
      return new ApiError(message, status, body);
  }
}
