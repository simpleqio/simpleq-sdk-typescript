// Public types for @simpleq/sdk.

/** Lifecycle status of a job. */
export type JobStatus = 'pending' | 'processing' | 'awaiting_ack' | 'completed' | 'failed' | 'dead';

/** Outcome of a single delivery attempt. */
export type JobAttemptStatus = 'success' | 'failed' | 'nacked' | 'deferred';

/** The JSON envelope SimpleQ POSTs to your webhook. Your data is under `payload`. */
export interface WebhookPayload {
  id: string;
  queue: string;
  payload: Record<string, unknown>;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
}

/** Body of `POST /v1/queues/:queueName/jobs`. */
export interface PublishJobRequest {
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  /** Seconds (0–86400). */
  delay?: number;
}

/** Response of a publish: `201` created or `200` idempotent hit. */
export interface PublishJobResponse {
  id: string;
  status: JobStatus;
  createdAt: string;
}

/** A single delivery attempt, as returned by `getJob`. Timestamps are ISO-8601 strings. */
export interface JobAttempt {
  attempt: number;
  status: JobAttemptStatus;
  error: string | null;
  webhookStatusCode: number | null;
  timestamp: string;
}

/** A job document as returned by `GET /v1/jobs/:id`. Timestamps are ISO-8601 strings. */
export interface Job {
  _id: string;
  queueId: string;
  orgId: string;
  idempotencyKey: string | null;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  scheduledFor: string;
  lastError: string | null;
  history: JobAttempt[];
  createdAt: string;
  completedAt: string | null;
}

/** Response of the ack / nack / defer callbacks. */
export interface AckResponse {
  id: string;
  accepted: true;
}

export interface SimpleQOptions {
  /** API key. Defaults to `process.env.SIMPLEQ_API_KEY`. */
  apiKey?: string;
  /** Base URL of the SimpleQ API. Defaults to `https://api.simpleq.io`. */
  baseUrl?: string;
  /** Per-request timeout in seconds. Defaults to `30`. */
  timeout?: number;
  /** Max automatic retries for transient failures (network / 5xx / 429). Defaults to `2`. */
  maxRetries?: number;
  /** Custom fetch implementation (for testing or non-global environments). */
  fetch?: typeof fetch;
}

export interface PublishParams {
  /** Arbitrary JSON delivered verbatim to the queue's webhook. */
  payload: Record<string, unknown>;
  /** Dedupe key (≤255 chars). Publishing twice with the same key returns the original job. */
  idempotencyKey?: string;
  /** Delay first delivery by this many seconds (0–86400). */
  delay?: number;
  /**
   * When `true` (default), `publish` attaches an auto-generated idempotency key and reuses it
   * across automatic retries, so a retried request can never create a duplicate job. Set `false`
   * to send no key (at-least-once create semantics) when you don't supply your own.
   */
  idempotent?: boolean;
}

export interface NackOptions {
  /** `true` (default) re-queues with backoff; `false` dead-letters immediately. */
  retryable?: boolean;
  reason?: string;
}

export interface DeferOptions {
  /** Hold the job for this many seconds, then redeliver without burning an attempt (0–3600). */
  retryAfter: number;
  reason?: string;
}
