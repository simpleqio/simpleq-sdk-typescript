import { randomUUID } from 'node:crypto';
import { HttpClient } from './http.js';
import { SimpleQError, ValidationError } from './errors.js';
import { verifyWebhook, verifyWebhookSignature } from './webhooks.js';
import type {
  AckResponse,
  DeferOptions,
  Job,
  NackOptions,
  PublishJobResponse,
  PublishParams,
  SimpleQOptions,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.simpleq.io';
// Customer-facing durations are seconds throughout SimpleQ; convert to ms at the fetch boundary.
const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_MAX_RETRIES = 2;
// Injected from package.json at build time (tsup) and test time (vitest) via `define`, so
// `npm version` is the single source of truth and the User-Agent header can never drift.
declare const __SDK_VERSION__: string;
const VERSION = __SDK_VERSION__;

/** The SimpleQ client: publish jobs, read job status, and run the ack-mode callbacks. */
export class SimpleQ {
  private readonly http: HttpClient;

  /** Webhook signature helpers. Usable without an API key (only a `signingSecret` is needed). */
  readonly webhooks = {
    verifyWebhookSignature,
    verifyWebhook,
  };

  constructor(options: SimpleQOptions = {}) {
    const apiKey = options.apiKey ?? process.env.SIMPLEQ_API_KEY;
    if (!apiKey) {
      throw new SimpleQError('A SimpleQ API key is required. Pass { apiKey } or set SIMPLEQ_API_KEY.');
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new SimpleQError('No fetch implementation found. Use Node 18+ or pass { fetch }.');
    }

    this.http = new HttpClient({
      apiKey,
      baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
      timeout: (options.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      fetchImpl,
      userAgent: `simpleq-node/${VERSION}`,
    });
  }

  /**
   * Publish a job to a queue. Retries transient failures automatically; the idempotency key
   * (yours, or one generated per call when you omit it) is reused across those retries, so a
   * retry can never create a duplicate job. A 200 (idempotent hit) and a 201 (created) are both
   * returned as success.
   */
  async publish(queueName: string, params: PublishParams): Promise<PublishJobResponse> {
    const idempotencyKey = params.idempotencyKey ?? randomUUID();

    const body: Record<string, unknown> = { payload: params.payload };
    if (idempotencyKey !== undefined) body.idempotencyKey = idempotencyKey;
    if (params.delay !== undefined) body.delay = params.delay;

    return this.http.request<PublishJobResponse>({
      method: 'POST',
      path: `/v1/queues/${encodeURIComponent(queueName)}/jobs`,
      body,
    });
  }

  /** Fetch a job's current status and attempt history. */
  async getJob(jobId: string): Promise<Job> {
    return this.http.request<Job>({
      method: 'GET',
      path: `/v1/jobs/${encodeURIComponent(jobId)}`,
    });
  }

  /** Ack a job (ack-mode queues): report successful completion. */
  async ack(jobId: string): Promise<AckResponse> {
    return this.http.request<AckResponse>({
      method: 'POST',
      path: `/v1/jobs/${encodeURIComponent(jobId)}/ack`,
      body: {},
    });
  }

  /** Nack a job (ack-mode queues): report failure. `retryable: false` dead-letters immediately. */
  async nack(jobId: string, options: NackOptions = {}): Promise<AckResponse> {
    return this.http.request<AckResponse>({
      method: 'POST',
      path: `/v1/jobs/${encodeURIComponent(jobId)}/nack`,
      body: options,
    });
  }

  /**
   * Defer a job (ack-mode queues): report downstream backpressure.
   *
   * By default this holds the WHOLE queue for `retryAfter` seconds, then releases
   * one job as a probe — a 429 describes the downstream, and a SimpleQ queue points
   * at one webhook URL. Held jobs are never delivered, so they are not billed — the
   * event costs one probe delivery rather than one per job. Backpressure never counts
   * against `maxAttempts`. Pass `scope: 'job'` to hold only this job.
   */
  async defer(jobId: string, options: DeferOptions): Promise<AckResponse> {
    const { retryAfter } = options ?? {};
    // No upper bound: retryAfter is honored as given. The job's 24h delivery lifetime
    // is the only thing that bounds a hold, and it dead-letters rather than clamping.
    if (typeof retryAfter !== 'number' || !Number.isFinite(retryAfter) || retryAfter < 0) {
      throw new ValidationError('defer requires retryAfter to be a finite number of seconds ≥ 0.', 400, undefined);
    }
    return this.http.request<AckResponse>({
      method: 'POST',
      path: `/v1/jobs/${encodeURIComponent(jobId)}/defer`,
      body: options,
    });
  }
}
