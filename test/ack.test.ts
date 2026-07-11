import { describe, it, expect } from 'vitest';
import { SimpleQ, ValidationError } from '../src/index.js';
import { jsonResponse, mockFetch } from './helpers.js';

const ACCEPTED = { id: 'job_1', accepted: true };
const client = (fetchImpl: typeof fetch) => new SimpleQ({ apiKey: 'sq_live_test', fetch: fetchImpl });

describe('ack / nack / defer', () => {
  it('ack posts to the ack endpoint', async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse(ACCEPTED)]);
    const res = await client(fetchImpl).ack('job_1');
    expect(res).toEqual(ACCEPTED);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/v1/jobs/job_1/ack');
  });

  it('nack sends retryable and reason', async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse(ACCEPTED)]);
    await client(fetchImpl).nack('job_1', { retryable: false, reason: 'bad input' });
    expect(calls[0].url).toContain('/v1/jobs/job_1/nack');
    expect(calls[0].body).toEqual({ retryable: false, reason: 'bad input' });
  });

  it('nack defaults to an empty body (server applies retryable=true)', async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse(ACCEPTED)]);
    await client(fetchImpl).nack('job_1');
    expect(calls[0].body).toEqual({});
  });

  it('defer sends retryAfter and reason', async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse(ACCEPTED)]);
    await client(fetchImpl).defer('job_1', { retryAfter: 30, reason: 'rate limited' });
    expect(calls[0].url).toContain('/v1/jobs/job_1/defer');
    expect(calls[0].body).toEqual({ retryAfter: 30, reason: 'rate limited' });
  });

  it('defer rejects negative and non-finite retryAfter before making a request', async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse(ACCEPTED)]);
    const c = client(fetchImpl);
    await expect(c.defer('job_1', { retryAfter: -1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(c.defer('job_1', { retryAfter: NaN })).rejects.toBeInstanceOf(ValidationError);
    await expect(c.defer('job_1', { retryAfter: Infinity })).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it('defer has no upper bound — large holds reach the server (bounded by maxDefers + the 24h lifetime there)', async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse(ACCEPTED)]);
    await client(fetchImpl).defer('job_1', { retryAfter: 4000 });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ retryAfter: 4000 });
  });
});
