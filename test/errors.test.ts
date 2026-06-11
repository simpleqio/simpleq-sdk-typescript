import { describe, it, expect } from 'vitest';
import {
  SimpleQ,
  ApiError,
  AuthenticationError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  SimpleQError,
} from '../src/index.js';
import { jsonResponse, mockFetch } from './helpers.js';

const client = (fetchImpl: typeof fetch, options: Record<string, unknown> = {}) =>
  new SimpleQ({ apiKey: 'sq_live_test', fetch: fetchImpl, ...options });

describe('error mapping', () => {
  it('maps 401 to AuthenticationError', async () => {
    const { fetchImpl } = mockFetch([() => jsonResponse({ error: 'unauthorized' }, 401)]);
    await expect(client(fetchImpl).getJob('j')).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('maps 400 and carries the structured error body', async () => {
    const flat = { formErrors: [], fieldErrors: { payload: ['Required'] } };
    const { fetchImpl } = mockFetch([() => jsonResponse({ error: flat }, 400)]);
    await client(fetchImpl)
      .getJob('j')
      .then(
        () => expect.fail('should have thrown'),
        (err: unknown) => {
          expect(err).toBeInstanceOf(ValidationError);
          expect((err as ApiError).status).toBe(400);
          expect((err as ApiError).body).toEqual({ error: flat });
        },
      );
  });

  it('maps 404 and carries the string error body', async () => {
    const { fetchImpl } = mockFetch([() => jsonResponse({ error: 'Job not found' }, 404)]);
    await client(fetchImpl)
      .getJob('j')
      .catch((err: unknown) => {
        expect(err).toBeInstanceOf(NotFoundError);
        expect((err as ApiError).body).toEqual({ error: 'Job not found' });
      });
  });

  it('maps 429 to RateLimitError with retryAfter from the header', async () => {
    const { fetchImpl } = mockFetch([() => jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '12' })]);
    // 429 is retryable; maxRetries: 0 surfaces it immediately.
    await client(fetchImpl, { maxRetries: 0 })
      .getJob('j')
      .catch((err: unknown) => {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryAfter).toBe(12);
      });
  });

  it('all API errors are catchable as both SimpleQError and ApiError', async () => {
    const { fetchImpl } = mockFetch([() => jsonResponse({ error: 'x' }, 401)]);
    await client(fetchImpl)
      .getJob('j')
      .catch((err: unknown) => {
        expect(err).toBeInstanceOf(SimpleQError);
        expect(err).toBeInstanceOf(ApiError);
      });
  });

  it('throws at construction without an API key', () => {
    const previous = process.env.SIMPLEQ_API_KEY;
    delete process.env.SIMPLEQ_API_KEY;
    try {
      expect(() => new SimpleQ({ fetch: (() => undefined) as unknown as typeof fetch })).toThrow(SimpleQError);
    } finally {
      if (previous !== undefined) process.env.SIMPLEQ_API_KEY = previous;
    }
  });
});
