import { describe, it, expect } from 'vitest';
import { SimpleQBackpressure, retryAfterSeconds } from '../src/index.js';

describe('SimpleQBackpressure.from', () => {
  it('passes through 429/503/529 and reads retry-after from a plain headers object', () => {
    const err = { status: 429, message: 'rate limited', headers: { 'retry-after': '17' } };
    const bp = SimpleQBackpressure.from(err);
    expect(bp.status).toBe(429);
    expect(bp.retryAfter).toBe(17);
    expect(bp.message).toBe('rate limited');
  });

  it('reads retry-after from a Headers instance', () => {
    const err = { status: 503, headers: new Headers({ 'Retry-After': '42' }) };
    const bp = SimpleQBackpressure.from(err);
    expect(bp.status).toBe(503);
    expect(bp.retryAfter).toBe(42);
  });

  it('reads retry-after from err.response.headers', () => {
    const err = { status: 529, response: { headers: { 'retry-after': '5' } } };
    const bp = SimpleQBackpressure.from(err);
    expect(bp.status).toBe(529);
    expect(bp.retryAfter).toBe(5);
  });

  it('maps non-backpressure statuses to 503', () => {
    expect(SimpleQBackpressure.from({ status: 500 }).status).toBe(503);
    expect(SimpleQBackpressure.from(new Error('boom')).status).toBe(503);
    expect(SimpleQBackpressure.from(undefined).status).toBe(503);
  });

  it('uses the fallback when no header is present, and stays undefined without one', () => {
    expect(SimpleQBackpressure.from({ status: 429 }, { fallback: 30 }).retryAfter).toBe(30);
    expect(SimpleQBackpressure.from({ status: 429 }).retryAfter).toBeUndefined();
  });

  it('ignores non-numeric retry-after values (HTTP dates)', () => {
    const err = { status: 429, headers: { 'retry-after': 'Wed, 11 Jun 2026 07:28:00 GMT' } };
    expect(SimpleQBackpressure.from(err, { fallback: 10 }).retryAfter).toBe(10);
  });

  it('honors an explicit reason', () => {
    const bp = SimpleQBackpressure.from({ status: 429 }, { reason: 'anthropic 429' });
    expect(bp.message).toBe('anthropic 429');
  });
});

describe('retryAfterSeconds', () => {
  it('reads a plain headers object', () => {
    expect(retryAfterSeconds({ headers: { 'retry-after': '17' } })).toBe(17);
  });

  it('reads a Headers instance', () => {
    expect(retryAfterSeconds({ headers: new Headers({ 'Retry-After': '42' }) })).toBe(42);
  });

  it('reads err.response.headers', () => {
    expect(retryAfterSeconds({ response: { headers: { 'retry-after': '5' } } })).toBe(5);
  });

  it('returns undefined for a missing header', () => {
    expect(retryAfterSeconds({ status: 429 })).toBeUndefined();
    expect(retryAfterSeconds(undefined)).toBeUndefined();
    expect(retryAfterSeconds(new Error('boom'))).toBeUndefined();
  });

  it('returns undefined for a non-numeric (HTTP-date) value', () => {
    expect(retryAfterSeconds({ headers: { 'retry-after': 'Wed, 11 Jun 2026 07:28:00 GMT' } })).toBeUndefined();
  });
});
