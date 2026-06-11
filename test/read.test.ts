import { describe, it, expect } from 'vitest';
import { SimpleQ, NotFoundError } from '../src/index.js';
import { jsonResponse, mockFetch } from './helpers.js';

const JOB = {
  id: 'job_1',
  queue: 'emails',
  status: 'completed',
  attempts: 1,
  maxAttempts: 3,
  idempotencyKey: null,
  payload: { to: 'a@b.com' },
  scheduledFor: '2026-01-01T00:00:00.000Z',
  lastError: null,
  history: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:01.000Z',
};

const client = (fetchImpl: typeof fetch) => new SimpleQ({ apiKey: 'sq_live_test', fetch: fetchImpl });

describe('getJob', () => {
  it('returns the typed job document', async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse(JOB)]);
    const res = await client(fetchImpl).getJob('job_1');
    expect(res.id).toBe('job_1');
    expect(res.queue).toBe('emails');
    expect(res.status).toBe('completed');
    expect(res.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('/v1/jobs/job_1');
  });

  it('throws NotFoundError on 404', async () => {
    const { fetchImpl } = mockFetch([() => jsonResponse({ error: 'Job not found' }, 404)]);
    await expect(client(fetchImpl).getJob('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('retries a transient 503 then succeeds', async () => {
    const { fetchImpl, calls } = mockFetch([() => jsonResponse({ error: 'down' }, 503), () => jsonResponse(JOB, 200)]);
    const res = await client(fetchImpl).getJob('job_1');
    expect(res.id).toBe('job_1');
    expect(calls).toHaveLength(2);
  });
});
