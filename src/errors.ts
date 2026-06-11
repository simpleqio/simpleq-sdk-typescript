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

/** Thrown by `constructEvent` when a webhook signature does not verify. */
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
