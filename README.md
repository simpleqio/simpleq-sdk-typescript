# @simpleq/sdk

Official Node/TypeScript SDK for [SimpleQ](https://docs.simpleq.io): publish jobs, verify webhook signatures, and run the ack-mode callbacks. ESM + CommonJS, bundled types, zero runtime dependencies. Requires Node 18+ (uses the global `fetch`). All durations are in **seconds**.

```bash
npm install @simpleq/sdk
```

## Client

```ts
import { SimpleQ } from '@simpleq/sdk';

const simpleq = new SimpleQ({ apiKey: process.env.SIMPLEQ_API_KEY });
```

`SimpleQ(options)` — every option is optional:

| Option | Default | Meaning |
| --- | --- | --- |
| `apiKey` | `process.env.SIMPLEQ_API_KEY` | API key (`sq_live_…`). Throws at construction if absent. |
| `baseUrl` | `https://api.simpleq.io` | API base URL. |
| `timeout` | `30` | Per-request timeout, **seconds**. |
| `maxRetries` | `2` | Automatic retries for transient failures (network / 5xx / 429). |
| `fetch` | global `fetch` | Custom fetch implementation. |

## publish

```ts
const job = await simpleq.publish('emails', {
  payload: { to: 'a@b.com', template: 'welcome' }, // delivered verbatim to the queue's webhook
  idempotencyKey: `welcome:${userId}`,             // optional, ≤255 chars
  delay: 30,                                        // optional, seconds (0–86400)
});
// job: { id: string; status: string; createdAt: string }
```

`publish` retries transient failures and, by default, attaches a generated idempotency key reused across those retries — a retry can never create a duplicate job, and both `200` (idempotent hit) and `201` (created) resolve as success. Omit `idempotencyKey` to get that auto key, pass your own for business-level dedupe, or set `idempotent: false` to send none.

## constructEvent — verify a webhook

`constructEvent` verifies the `x-simpleq-signature` header against the **raw** request body and returns the typed envelope, throwing `SignatureVerificationError` on a mismatch. It needs only the queue's `signingSecret` — no API key.

```ts
import { constructEvent } from '@simpleq/sdk';

const job = constructEvent(rawBody, signatureHeader, signingSecret);
// job: { id, queue, payload, attempt, maxAttempts, createdAt }
```

`rawBody` is a `string`, `Buffer`, or `Uint8Array`. `verifyWebhookSignature(rawBody, header, secret): boolean` is the non-throwing variant.

### Express — `@simpleq/sdk/express`

```ts
import express from 'express';
import { simpleqWebhook } from '@simpleq/sdk/express';

const app = express();

app.post(
  '/webhook',
  simpleqWebhook(process.env.SQ_SIGNING_SECRET, async (job) => {
    await doWork(job.payload);
  }),
);
```

`simpleqWebhook(signingSecret, handler)` captures the raw body, verifies the signature, and maps the handler outcome to a response (see [Response contract](#response-contract)).

### Nest.js — `@simpleq/sdk/nest`

Create the app with `rawBody: true`, register `SimpleQModule.forRoot`, then guard the route and inject the typed job:

```ts
// main.ts
const app = await NestFactory.create(AppModule, { rawBody: true });
```

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { SimpleQModule } from '@simpleq/sdk/nest';

@Module({
  imports: [SimpleQModule.forRoot({ signingSecret: process.env.SQ_SIGNING_SECRET })],
  controllers: [WebhookController],
})
export class AppModule {}
```

```ts
// webhook.controller.ts
import { Controller, HttpCode, Post, UseFilters, UseGuards } from '@nestjs/common';
import type { WebhookPayload } from '@simpleq/sdk';
import { SimpleQSignatureGuard, SimpleQJob, SimpleQBackpressureFilter } from '@simpleq/sdk/nest';

@Controller('webhook')
export class WebhookController {
  @Post()
  @HttpCode(200)
  @UseGuards(SimpleQSignatureGuard)
  @UseFilters(SimpleQBackpressureFilter)
  async handle(@SimpleQJob() job: WebhookPayload) {
    await doWork(job.payload);
  }
}
```

## Response contract

The adapters map a handler outcome to a SimpleQ response identically:

| Handler | Response | SimpleQ |
| --- | --- | --- |
| resolves | `200` | **standard:** completes the job · **ack:** moves it to `awaiting_ack` |
| `throw new SimpleQBackpressure(retryAfter?, { status? })` | that status (default `503`) + `Retry-After` | holds and redelivers — no attempt burned |
| throws anything else | `500` | counts a failed attempt, retries with backoff |
| bad signature | `401` | not a job outcome |

Signal backpressure from a standard-mode handler when a downstream rate-limits you:

```ts
import { SimpleQBackpressure } from '@simpleq/sdk';

simpleqWebhook(secret, async (job) => {
  try {
    await callProvider(job.payload);
  } catch (err) {
    if (err.status === 429) throw new SimpleQBackpressure(err.retryAfter ?? 30); // seconds
    throw err;
  }
});
```

## Ack mode — ack / nack / defer

For work longer than the 15s delivery window, use an ack-mode queue: return `200` immediately, then report the outcome out of band.

```ts
simpleqWebhook(secret, async (job) => {
  queueMicrotask(async () => {
    try {
      await longRunningWork(job.payload);
      await simpleq.ack(job.id);
    } catch (err) {
      if (err.status === 429) await simpleq.defer(job.id, { retryAfter: 30 }); // seconds
      else await simpleq.nack(job.id, { retryable: true, reason: String(err) });
    }
  });
});
```

- `simpleq.ack(id)` → completed.
- `simpleq.nack(id, { retryable, reason? })` → failed. `retryable: false` dead-letters immediately.
- `simpleq.defer(id, { retryAfter, reason? })` → backpressure: held and redelivered, no attempt burned. `retryAfter` is seconds (0–3600).

Each resolves to `{ id, accepted: true }`.

## getJob

```ts
const job = await simpleq.getJob(jobId);
// job: { id, queue, status, attempts, maxAttempts, history, createdAt, completedAt, ... }
```

## Errors

Every thrown value extends `SimpleQError`. API responses throw `ApiError` (or a subclass) carrying `.status` and `.body`.

```ts
import { ApiError, NotFoundError, RateLimitError, SimpleQError } from '@simpleq/sdk';

try {
  await simpleq.publish('emails', { payload });
} catch (err) {
  if (err instanceof NotFoundError) handleUnknownQueue();        // 404
  else if (err instanceof RateLimitError) backOff(err.retryAfter); // 429, seconds
  else if (err instanceof ApiError) report(err.status, err.body);  // other non-2xx
  else if (err instanceof SimpleQError) report(err);               // network / signature / config
}
```

`ApiError` subclasses: `AuthenticationError` (401/403), `ValidationError` (400), `NotFoundError` (404), `RateLimitError` (429). Non-API: `SimpleQConnectionError` (network/timeout) and `SignatureVerificationError`.
