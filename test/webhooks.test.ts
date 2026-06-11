import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyWebhookSignature,
  constructEvent,
  SIGNATURE_HEADER,
  SignatureVerificationError,
} from '../src/index.js';

const SECRET = 'whsec_test_secret';
const BODY =
  '{"id":"job_123","queue":"emails","payload":{"to":"a@b.com"},"attempt":1,"maxAttempts":3,"createdAt":"2026-01-01T00:00:00.000Z"}';
// Frozen known-answer vector — a regression in the digest changes this.
const FROZEN_SIG = 'sha256=e43a7997ac90d33868eff6deba3b4088e79f110cdb6eb3be9c04a836ce7b1b6d';

// Mirrors apps/worker signPayload — the SDK must verify exactly what the worker signs.
function workerSign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyWebhookSignature', () => {
  it('accepts the frozen known-answer signature', () => {
    expect(verifyWebhookSignature(BODY, FROZEN_SIG, SECRET)).toBe(true);
  });

  it('matches the worker signing formula', () => {
    expect(workerSign(BODY, SECRET)).toBe(FROZEN_SIG);
    expect(verifyWebhookSignature(BODY, workerSign(BODY, SECRET), SECRET)).toBe(true);
  });

  it('accepts a Buffer body', () => {
    expect(verifyWebhookSignature(Buffer.from(BODY, 'utf8'), FROZEN_SIG, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(BODY.replace('a@b.com', 'evil@x.com'), FROZEN_SIG, SECRET)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verifyWebhookSignature(BODY, FROZEN_SIG, 'wrong-secret')).toBe(false);
  });

  it('returns false (never throws) for a missing or empty header', () => {
    expect(verifyWebhookSignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, '', SECRET)).toBe(false);
  });

  it('returns false (never throws) for a wrong-length header', () => {
    // timingSafeEqual throws on differing lengths — the length guard must short-circuit.
    expect(() => verifyWebhookSignature(BODY, 'sha256=deadbeef', SECRET)).not.toThrow();
    expect(verifyWebhookSignature(BODY, 'sha256=deadbeef', SECRET)).toBe(false);
  });
});

describe('constructEvent', () => {
  it('returns the typed payload on a valid signature', () => {
    const event = constructEvent(BODY, FROZEN_SIG, SECRET);
    expect(event.id).toBe('job_123');
    expect(event.queue).toBe('emails');
    expect(event.attempt).toBe(1);
    expect(event.maxAttempts).toBe(3);
    expect(event.payload).toEqual({ to: 'a@b.com' });
  });

  it('throws SignatureVerificationError before parsing on a bad signature', () => {
    // Body is not valid JSON — must still surface the signature error, not a JSON parse error.
    expect(() => constructEvent('not-json', 'sha256=bad', SECRET)).toThrow(SignatureVerificationError);
  });

  it('exports the canonical header name', () => {
    expect(SIGNATURE_HEADER).toBe('x-simpleq-signature');
  });
});
