import { describe, it, expect } from 'vitest';
import { SimpleQ, ApiError, NotFoundError, ValidationError } from '../src/index.js';
import { jsonResponse, mockFetch } from './helpers.js';

const CREATED = { id: 'job_1', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' };

function client(fetchImpl: typeof fetch, options: Record<string, unknown> = {}) {
  return new SimpleQ({ apiKey: 'sq_live_test', fetch: fetchImpl, ...options });
}

function bodyOf(call: { body: unknown }): Record<string, unknown> {
  return call.body as Record<string, unknown>;
}

describe('publish', () => {
  it('returns the created job (201) and auto-attaches an idempotency key', async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse(CREATED, 201)]);
    const res = await client(fetchImpl).publish('emails', { payload: { to: 'a@b.com' } });
    expect(res).toEqual(CREATED);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/v1/queues/emails/jobs');
    expect(calls[0].headers['authorization']).toBe('Bearer sq_live_test');
    expect(typeof bodyOf(calls[0]).idempotencyKey).toBe('string');
    expect(bodyOf(calls[0]).payload).toEqual({ to: 'a@b.com' });
  });

  it('treats a 200 idempotent hit as success', async () => {
    const hit = { id: 'job_existing', status: 'completed', createdAt: '2026-01-01T00:00:00.000Z' };
    const { fetchImpl } = mockFetch([jsonResponse(hit, 200)]);
    const res = await client(fetchImpl).publish('emails', { payload: {}, idempotencyKey: 'k1' });
    expect(res).toEqual(hit);
  });

  it('passes a caller-supplied idempotency key verbatim', async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse(CREATED, 201)]);
    await client(fetchImpl).publish('emails', { payload: {}, idempotencyKey: 'my-key' });
    expect(bodyOf(calls[0]).idempotencyKey).toBe('my-key');
  });

  it('auto-generates a key when none is supplied', async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse(CREATED, 201)]);
    await client(fetchImpl).publish('emails', { payload: {} });
    expect(typeof bodyOf(calls[0]).idempotencyKey).toBe('string');
    expect((bodyOf(calls[0]).idempotencyKey as string).length).toBeGreaterThan(0);
  });

  it('includes delay when provided', async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse(CREATED, 201)]);
    await client(fetchImpl).publish('emails', { payload: {}, delay: 30 });
    expect(bodyOf(calls[0]).delay).toBe(30);
  });

  it('retries a 503 and reuses the SAME idempotency key across attempts', async () => {
    const { fetchImpl, calls } = mockFetch([
      () => jsonResponse({ error: 'overloaded' }, 503),
      () => jsonResponse(CREATED, 201),
    ]);
    const res = await client(fetchImpl).publish('emails', { payload: {} });
    expect(res).toEqual(CREATED);
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[0]).idempotencyKey).toBe(bodyOf(calls[1]).idempotencyKey);
  });

  it('does not retry a 404', async () => {
    const { fetchImpl, calls } = mockFetch([() => jsonResponse({ error: "Queue 'x' not found" }, 404)]);
    await expect(client(fetchImpl).publish('x', { payload: {} })).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toHaveLength(1);
  });

  it('does not retry a 400', async () => {
    const { fetchImpl, calls } = mockFetch([
      () => jsonResponse({ error: { formErrors: [], fieldErrors: {} } }, 400),
    ]);
    await expect(client(fetchImpl).publish('x', { payload: {} })).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(1);
  });

  it('surfaces the last ApiError after exhausting retries', async () => {
    const { fetchImpl, calls } = mockFetch([() => jsonResponse({ error: 'down' }, 503)]);
    await expect(client(fetchImpl, { maxRetries: 2 }).publish('emails', { payload: {} })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(calls).toHaveLength(3); // 1 initial + 2 retries
  });
});
