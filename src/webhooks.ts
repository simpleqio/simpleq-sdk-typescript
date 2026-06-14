// Standalone webhook verification — no API key or client required. Importable as
// `@simpleq/sdk/webhooks` with only `node:crypto` pulled in.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignatureVerificationError } from './errors.js';
import type { WebhookPayload } from './types.js';

/** The header SimpleQ sends with every webhook delivery. */
export const SIGNATURE_HEADER = 'x-simpleq-signature';

function toBuffer(rawBody: string | Buffer | Uint8Array): Buffer {
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  if (Buffer.isBuffer(rawBody)) return rawBody;
  return Buffer.from(rawBody);
}

function expectedSignature(rawBody: string | Buffer | Uint8Array, signingSecret: string): string {
  return 'sha256=' + createHmac('sha256', signingSecret).update(toBuffer(rawBody)).digest('hex');
}

/**
 * Verify the `x-simpleq-signature` header against the raw request body, in constant time.
 * Returns a boolean and never throws — a missing or malformed header simply returns `false`.
 *
 * Always pass the *raw* body bytes (a string or Buffer), never a re-serialized parsed object.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer | Uint8Array,
  signatureHeader: string | null | undefined,
  signingSecret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = Buffer.from(expectedSignature(rawBody, signingSecret));
  const received = Buffer.from(signatureHeader);
  // timingSafeEqual throws on differing lengths — guard before the constant-time compare.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * Verify the signature and return the parsed, typed webhook envelope (the equivalent of
 * Stripe's `constructEvent`). Throws `SignatureVerificationError` if the signature does
 * not match — the body is only parsed after verification passes, so a tampered payload
 * never reaches `JSON.parse`.
 */
export function verifyWebhook(
  rawBody: string | Buffer | Uint8Array,
  signatureHeader: string | null | undefined,
  signingSecret: string,
): WebhookPayload {
  if (!verifyWebhookSignature(rawBody, signatureHeader, signingSecret)) {
    throw new SignatureVerificationError('SimpleQ webhook signature verification failed');
  }
  const text = typeof rawBody === 'string' ? rawBody : toBuffer(rawBody).toString('utf8');
  return JSON.parse(text) as WebhookPayload;
}
