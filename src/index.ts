export { SimpleQ, SimpleQ as default } from './client.js';

export { verifyWebhookSignature, verifyWebhook, SIGNATURE_HEADER } from './webhooks.js';

export {
  SimpleQError,
  SimpleQConnectionError,
  SignatureVerificationError,
  SimpleQBackpressure,
  retryAfterSeconds,
  ApiError,
  AuthenticationError,
  ValidationError,
  NotFoundError,
  RateLimitError,
} from './errors.js';
export type { BackpressureStatus } from './errors.js';

export type {
  WebhookPayload,
  Job,
  JobAttempt,
  JobStatus,
  JobAttemptStatus,
  AckResponse,
  PublishJobRequest,
  PublishJobResponse,
  PublishParams,
  NackOptions,
  DeferOptions,
  SimpleQOptions,
} from './types.js';
