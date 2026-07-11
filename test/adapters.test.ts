import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';
import { UnauthorizedException } from '@nestjs/common';
import { simpleqWebhookHandler, type SimpleQWebhookHandler } from '../src/express.js';
import {
  SimpleQSignatureGuard,
  SimpleQBackpressureFilter,
  SimpleQModule,
  SimpleQJob,
  SIMPLEQ_WEBHOOK_OPTIONS,
} from '../src/nest.js';
import { SimpleQBackpressure } from '../src/index.js';

const SECRET = 'whsec_test_secret';
const sign = (body: string) => 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
const envelope = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'j1',
    queue: 'q',
    payload: {},
    attempt: 1,
    maxAttempts: 3,
    deferCount: 0,
    createdAt: 'now',
    ...over,
  });

// ---------- Express adapter (integration) ----------

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

async function start(handler: SimpleQWebhookHandler): Promise<string> {
  const app = express();
  app.post('/webhook', simpleqWebhookHandler(SECRET, handler));
  const s = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  server = s;
  const address = s.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}/webhook`;
}

function post(url: string, body: string, signature?: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature ? { 'x-simpleq-signature': signature } : {}) },
    body,
  });
}

describe('express adapter', () => {
  it('verifies a good signature, runs the handler, and responds 200', async () => {
    let received: { id: string } | undefined;
    const url = await start(async (job) => {
      received = job;
    });
    const body = envelope({ payload: { x: 1 } });
    const res = await post(url, body, sign(body));
    expect(res.status).toBe(200);
    expect(received?.id).toBe('j1');
  });

  it('responds 401 for a bad signature', async () => {
    const url = await start(async () => undefined);
    const res = await post(url, envelope(), 'sha256=bad');
    expect(res.status).toBe(401);
  });

  it('maps SimpleQBackpressure to its status and Retry-After', async () => {
    const url = await start(async () => {
      throw new SimpleQBackpressure(15);
    });
    const body = envelope();
    const res = await post(url, body, sign(body));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('15');
  });

  it('responds 500 when the handler throws a generic error', async () => {
    const url = await start(async () => {
      throw new Error('boom');
    });
    const body = envelope();
    const res = await post(url, body, sign(body));
    expect(res.status).toBe(500);
  });
});

// ---------- Nest adapter (unit) ----------

function execContext(req: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => undefined }),
  } as never;
}

describe('nest adapter', () => {
  it('guard verifies the signature and stashes the typed job', () => {
    const body = envelope();
    const req: Record<string, unknown> = {
      rawBody: Buffer.from(body, 'utf8'),
      headers: { 'x-simpleq-signature': sign(body) },
    };
    const guard = new SimpleQSignatureGuard({ signingSecret: SECRET });
    expect(guard.canActivate(execContext(req))).toBe(true);
    expect((req.simpleqJob as { id: string }).id).toBe('j1');
  });

  it('guard throws UnauthorizedException on a bad signature', () => {
    const req = { rawBody: Buffer.from('{}'), headers: { 'x-simpleq-signature': 'sha256=bad' } };
    const guard = new SimpleQSignatureGuard({ signingSecret: SECRET });
    expect(() => guard.canActivate(execContext(req))).toThrow(UnauthorizedException);
  });

  it('guard errors clearly when rawBody is missing', () => {
    const guard = new SimpleQSignatureGuard({ signingSecret: SECRET });
    expect(() => guard.canActivate(execContext({ headers: {} }))).toThrow(/rawBody/);
  });

  it('backpressure filter sets the status and Retry-After header', () => {
    const recorded: { header?: [string, string]; status?: number; ended?: boolean } = {};
    const res = {
      setHeader: (k: string, v: string) => {
        recorded.header = [k, v];
      },
      status: (code: number) => {
        recorded.status = code;
        return {
          end: () => {
            recorded.ended = true;
          },
        };
      },
    };
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as never;
    new SimpleQBackpressureFilter().catch(new SimpleQBackpressure(20, { status: 429 }), host);
    expect(recorded.header).toEqual(['Retry-After', '20']);
    expect(recorded.status).toBe(429);
    expect(recorded.ended).toBe(true);
  });

  it('forRoot wires the options provider and exports the guard', () => {
    const mod = SimpleQModule.forRoot({ signingSecret: SECRET });
    expect(mod.module).toBe(SimpleQModule);
    expect(mod.providers).toContainEqual({
      provide: SIMPLEQ_WEBHOOK_OPTIONS,
      useValue: { signingSecret: SECRET },
    });
    expect(mod.exports).toContain(SimpleQSignatureGuard);
  });

  it('exports the @SimpleQJob param decorator', () => {
    expect(typeof SimpleQJob).toBe('function');
  });
});
