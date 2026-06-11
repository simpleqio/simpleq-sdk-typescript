import { vi } from 'vitest';

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const body = data === undefined ? '' : JSON.stringify(data);
  return new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
}

export interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

type Result = Response | (() => Response | Promise<Response>) | Error;

/**
 * A fake `fetch` that returns the given results in order (the last one repeats). Pass a thunk
 * `() => jsonResponse(...)` when a result is consumed more than once (a Response body is single-use).
 */
export function mockFetch(results: Result[]): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    const result = results[Math.min(i, results.length - 1)];
    i++;
    if (result instanceof Error) throw result;
    return typeof result === 'function' ? result() : result;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}
