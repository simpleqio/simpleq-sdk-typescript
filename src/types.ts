// Public types for @simpleq/sdk.

/**
 * Lifecycle status of a job. 'dead' is the single terminal-failure state
 * (attempts exhausted or unrecoverable — the job is in the DLQ if enabled).
 * Between retries a job stays 'processing'; per-attempt failures appear in
 * `history[]` as JobAttemptStatus 'failed'.
 */
export type JobStatus = 'pending' | 'processing' | 'awaiting_ack' | 'completed' | 'dead';

/** Outcome of a single delivery attempt. */
export type JobAttemptStatus = 'success' | 'failed' | 'nacked' | 'deferred';

/** The JSON envelope SimpleQ POSTs to your webhook. Your data is under `payload`. */
export interface WebhookPayload {
  id: string;
  queue: string;
  payload: Record<string, unknown>;
  attempt: number;
  maxAttempts: number;
  /**
   * Backpressure holds (defers) this job has spent so far. Never counts against
   * `maxAttempts`. Use it to apply your own defer cap (e.g. nack after N holds).
   */
  deferCount: number;
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

/** A job as returned by `GET /v1/jobs/:id`. Timestamps are ISO-8601 strings. */
export interface Job {
  id: string;
  /** The queue name. */
  queue: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  /**
   * Backpressure holds (defers) spent so far, bounded by the queue's `maxDefers`
   * budget — the counter behind a `defer_cap_exhausted` dead-letter. Never
   * counts against `maxAttempts`.
   */
  deferCount: number;
  idempotencyKey: string | null;
  payload: Record<string, unknown>;
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
  /**
   * Dedupe key (≤255 chars) for cross-call deduplication: publishing again with the same key
   * returns the original job. Omit it and `publish` generates one per call and reuses it across
   * the SDK's automatic retries, so a retried request can never create a duplicate job.
   */
  idempotencyKey?: string;
  /** Delay first delivery by this many seconds (0–86400). */
  delay?: number;
}

export interface NackOptions {
  /** `true` (default) re-queues with backoff; `false` dead-letters immediately. */
  retryable?: boolean;
  reason?: string;
}

export interface DeferOptions {
  /**
   * Hold the job for this many seconds, then redeliver without burning an
   * attempt. Any finite value ≥ 0 — no fixed ceiling. Two platform bounds
   * apply instead: the queue's `maxDefers` budget (default 50 holds per job;
   * exhaustion dead-letters with `defer_cap_exhausted`) and the job's 24-hour
   * delivery lifetime (a hold that would outlive it dead-letters immediately
   * with `retry_after_exceeds_lifetime`). The defer call itself still succeeds
   * either way — the job resolves to held or dead-lettered.
   */
  retryAfter: number;
  reason?: string;
}
