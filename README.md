# @simpleq/sdk

[![npm](https://img.shields.io/npm/v/@simpleq/sdk.svg)](https://www.npmjs.com/package/@simpleq/sdk)
[![CI](https://github.com/simpleqio/simpleq-sdk-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/simpleqio/simpleq-sdk-typescript/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@simpleq/sdk.svg)](./LICENSE)

Official Node/TypeScript SDK for [SimpleQ](https://docs.simpleq.io): publish jobs, verify webhook signatures, and run the ack-mode callbacks. ESM + CommonJS, bundled types, zero runtime dependencies. Requires Node 22+. All durations are in **seconds**. The live API contract is machine-readable at [docs.simpleq.io/openapi.json](https://docs.simpleq.io/openapi.json).

Full SDK documentation: **[docs.simpleq.io/sdk](https://docs.simpleq.io/sdk/)**.

```bash
npm install @simpleq/sdk
```

## Client

An API key is **required** — pass `apiKey`, or set the `SIMPLEQ_API_KEY` environment variable and construct with no arguments. The constructor throws if neither is present.

```ts
import { SimpleQ } from '@simpleq/sdk';

// SIMPLEQ_API_KEY is read by the SDK automatically if no argument is passed
const simpleq = new SimpleQ({ apiKey: process.env.SIMPLEQ_API_KEY });
```

`SimpleQ(options)`:

| Option | Required | Default | Meaning |
| --- | --- | --- | --- |
| `apiKey` | yes (here or via `SIMPLEQ_API_KEY`) | `process.env.SIMPLEQ_API_KEY` | API key (`sq_live_…`). |
| `timeout` | no | `30` | Timeout for the SDK's **own** requests to the SimpleQ API, in seconds. |
| `maxRetries` | no | `2` | How many times the SDK retries **its own** API request on a transient failure (network / 5xx / 429). |

`timeout` and `maxRetries` govern the SDK's calls to the SimpleQ API (publishing, ack/nack/defer, getJob). They do **not** control how SimpleQ retries delivery to your webhook — `maxAttempts`, backoff, rate limits, and `ackTimeout` are [per-queue settings](https://docs.simpleq.io/reference/#queues) you configure when you create or edit a queue.

## publish

Publish a job to a queue.

```ts
const job = await simpleq.publish('emails', {
  payload: { to: 'a@b.com', template: 'welcome' },
  idempotencyKey: `welcome:${userId}`,
  delay: 30,
});
// job: {
//   id: string;
//   status: 'pending' | 'processing' | 'awaiting_ack' | 'completed' | 'dead';
//   createdAt: string;  // ISO 8601
// }
```

`publish(queueName, params)`:

| Param | Required | Constraint | Meaning |
| --- | --- | --- | --- |
| `payload` | yes | JSON object | Delivered verbatim to the queue's webhook. |
| `idempotencyKey` | no | ≤255 chars | Cross-call dedupe: publishing again with the same key returns the existing job. |
| `delay` | no | seconds, 0–86400 | Defer first delivery. |

If you omit the `idempotencyKey`, the `publish` method generates one per call and reuses it across the SDK's automatic retries, so a retried request can never create a duplicate job. Pass your own key to dedupe across *separate* calls (e.g. one welcome email per user). A `201` (created — status `pending`) and a `200` (idempotent hit — returns the existing job, any status) both resolve as success.

## Verifying webhooks

SimpleQ signs every delivery with an `x-simpleq-signature` header (HMAC-SHA256 of the raw body, keyed with the queue's `signingSecret`). Verify it before trusting the payload.

- **`verifyWebhook(rawBody, header, signingSecret)`** — the framework-agnostic primitive. Returns the typed envelope or throws `SignatureVerificationError`. Use it anywhere: Lambda, Cloud Functions, Fastify, Hono, Next.js route handlers, raw `http`.
- **Framework adapters** wrap that primitive for you, including the raw-body capture: **Express** via `simpleqWebhookHandler` (`@simpleq/sdk/express`), and **Nest.js** via `SimpleQModule`, `SimpleQSignatureGuard`, `@SimpleQJob()`, and `SimpleQBackpressureFilter` (`@simpleq/sdk/nest`).

> **`signingSecret` is per-queue.** Each queue has its own — store each as its own env var (e.g. `SQ_SIGNING_SECRET_EMAILS`). A worker serving multiple queues should expose **one webhook route per queue**, each wired to that queue's secret (you can't safely pick the secret from the unverified body).

### verifyWebhook — any framework

The primitive: verify the raw body and get back the typed envelope, or a `SignatureVerificationError`.

```ts
import { verifyWebhook } from '@simpleq/sdk';

const job = verifyWebhook(rawBody, signatureHeader, process.env.SQ_SIGNING_SECRET_EMAILS!);
// job: {
//   id: string;            // job ID — pass to ack/nack/defer
//   queue: string;         // queue name
//   payload: Record<string, unknown>;  // your data, verbatim
//   attempt: number;       // starts at 1
//   maxAttempts: number;
//   createdAt: string;     // ISO 8601 — when the job was published
// }
```

`rawBody` is a `string`, `Buffer`, or `Uint8Array`. `verifyWebhookSignature(rawBody, header, secret): boolean` is the non-throwing variant.

### Express — `@simpleq/sdk/express`

`simpleqWebhookHandler` captures the raw body, verifies the signature, and maps your handler's outcome to a response (see [Response contract](#response-contract)).

```ts
import express from 'express';
import { simpleqWebhookHandler } from '@simpleq/sdk/express';

const app = express();

app.post(
  '/webhook',
  simpleqWebhookHandler(process.env.SQ_SIGNING_SECRET_EMAILS!, async (job) => {
    // `job` is the verified, typed envelope. Resolve → 200.
    console.log(`processing job ${job.id} from queue ${job.queue}`);
  }),
);
```

### Nest.js — `@simpleq/sdk/nest`

Create the app with `rawBody: true`, register `SimpleQModule.forRoot`, then guard the route and inject the typed job.

```ts
// main.ts
const app = await NestFactory.create(AppModule, { rawBody: true });
```

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { SimpleQModule } from '@simpleq/sdk/nest';

@Module({
  imports: [SimpleQModule.forRoot({ signingSecret: process.env.SQ_SIGNING_SECRET_EMAILS! })],
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
    console.log(`processing job ${job.id} from queue ${job.queue}`);
  }
}
```

## Response contract

The adapters (`simpleqWebhookHandler`, the Nest guard) map your handler's outcome to a SimpleQ response.

| Handler | Response | SimpleQ |
| --- | --- | --- |
| resolves | `200` | **standard mode:** completes the job · **ack mode:** moves it to `awaiting_ack` |
| `throw new SimpleQBackpressure(retryAfter?, { status? })` | that status (default `503`) + `Retry-After` | holds and redelivers — no attempt burned |
| throws anything else | `500` | counts a failed attempt, retries with backoff |
| bad signature | `401` | not a job outcome |

**Backpressure** (a `429`/`503`/`529` from your downstream) tells SimpleQ to hold and redeliver the job without burning an attempt. In a **standard-mode** handler, `throw` a `SimpleQBackpressure` and the adapter turns it into the response; `SimpleQBackpressure.from(err, { fallback })` builds one from the downstream error, relaying its status and `Retry-After`.

```ts
import { SimpleQBackpressure } from '@simpleq/sdk';

simpleqWebhookHandler(process.env.SQ_SIGNING_SECRET_EMAILS!, async (job) => {
  try {
    await doTheWork(job.payload); // your downstream call
  } catch (err) {
    if (err.status === 429 || err.status === 503 || err.status === 529) {
      throw SimpleQBackpressure.from(err, { fallback: 30 });
    }
    throw err; // anything else → 500, retried with backoff
  }
});
```

In **ack mode** you've already returned `200`, so there's no response left to throw into — call `simpleq.defer(...)` out of band instead (see below).

## Ack mode

For work longer than the 15s delivery window, use an ack-mode queue: return `200` immediately, then do the work and report the outcome with `ack` / `nack` / `defer`. Send the `200` yourself from the handler (via `res`), then run the work — the adapter won't respond again once you have.

```ts
import express from 'express';
import { SimpleQ, retryAfterSeconds } from '@simpleq/sdk';
import { simpleqWebhookHandler } from '@simpleq/sdk/express';

const simpleq = new SimpleQ(); // reads SIMPLEQ_API_KEY
const app = express();

app.post(
  '/webhook',
  simpleqWebhookHandler(process.env.SQ_SIGNING_SECRET_EMAILS!, async (job, { res }) => {
    res.status(200).end(); // ack mode: respond now, do the work after

    try {
      await doTheWork(job.payload); // your downstream call
      await simpleq.ack(job.id);
    } catch (err) {
      if (err.status === 429 || err.status === 503 || err.status === 529) {
        // Backpressure: hold and redeliver, no attempt burned. Relay the downstream's Retry-After.
        await simpleq.defer(job.id, { retryAfter: retryAfterSeconds(err) ?? 10 });
      } else if (err.status >= 400 && err.status < 500) {
        await simpleq.nack(job.id, { retryable: false, reason: `downstream ${err.status}` }); // dead-letter
      } else {
        await simpleq.nack(job.id, { retryable: true, reason: String(err) }); // retry with backoff
      }
    }
  }),
);
```

The three callbacks, each resolving to `{ id: string; accepted: true }`:

| Callback | Effect |
| --- | --- |
| `simpleq.ack(id)` | Mark the job completed. |
| `simpleq.nack(id, { retryable?, reason? })` | Mark failed. `retryable: false` dead-letters immediately; default `true` retries with backoff. `reason` ≤500 chars. |
| `simpleq.defer(id, { retryAfter, reason? })` | Backpressure: held and redelivered, no attempt burned. `retryAfter` seconds (0–3600); `reason` ≤500 chars. |

## getJob

Fetch a job's current status and attempt history.

```ts
const job = await simpleq.getJob(jobId);
// job: {
//   id: string;
//   queue: string;                       // queue name
//   status: 'pending' | 'processing' | 'awaiting_ack' | 'completed' | 'dead';
//   attempts: number;
//   maxAttempts: number;
//   idempotencyKey: string | null;
//   payload: Record<string, unknown>;
//   scheduledFor: string;                // ISO 8601
//   lastError: string | null;
//   history: Array<{
//     attempt: number;
//     status: 'success' | 'failed' | 'nacked' | 'deferred';
//     error: string | null;
//     webhookStatusCode: number | null;
//     timestamp: string;                 // ISO 8601
//   }>;
//   createdAt: string;                   // ISO 8601
//   completedAt: string | null;          // ISO 8601
// }
```

## Retention

Once a job reaches a terminal state (completed or dead), its record — status and the full per-attempt `history` — is purged at its **72-hour-from-publish** deadline (on the next sweep pass), after which `getJob` throws `NotFoundError` (`.status === 404`). Dead-letter entries are removed at the same deadline, so a job that dies late in its life has correspondingly little replay time left. Idempotency keys dedupe for the job's retention lifetime: once the original job ages out, the same key creates a fresh job.

## Errors

Every thrown value extends `SimpleQError`. API responses throw `ApiError` (or a subclass) carrying `.status` and `.body`.

| Class | Thrown when | Extra fields |
| --- | --- | --- |
| `AuthenticationError` | `401`/`403` — missing, invalid, or revoked API key | `.status`, `.body` |
| `ValidationError` | `400` — request validation failed | `.status`, `.body` (field-level details) |
| `NotFoundError` | `404` — queue or job not found | `.status`, `.body` |
| `RateLimitError` | `429` — rate limited | `.status`, `.body`, `.retryAfter` (seconds) |
| `ApiError` | any other non-2xx | `.status`, `.body` |
| `SimpleQConnectionError` | network failure or timeout | — |
| `SignatureVerificationError` | webhook signature mismatch | — |
| `SimpleQError` | base class — catch-all (also config errors, e.g. missing API key) | — |

```ts
import { ApiError, NotFoundError, RateLimitError, SimpleQError } from '@simpleq/sdk';

try {
  await simpleq.publish('emails', { payload: { to: 'a@b.com' } });
} catch (err) {
  if (err instanceof NotFoundError) {
    console.error('Queue does not exist:', err.body);
  } else if (err instanceof RateLimitError) {
    console.error(`Rate limited; retry after ${err.retryAfter}s`);
  } else if (err instanceof ApiError) {
    console.error(`SimpleQ API error ${err.status}:`, err.body);
  } else if (err instanceof SimpleQError) {
    console.error('Network, signature, or config error:', err.message);
  } else {
    throw err;
  }
}
```
