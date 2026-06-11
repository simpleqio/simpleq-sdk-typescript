// Express adapter — `@simpleq/sdk/express`. Requires the optional `express` peer dependency.
import express from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { constructEvent, SIGNATURE_HEADER } from './webhooks.js';
import { SignatureVerificationError, SimpleQBackpressure } from './errors.js';
import type { WebhookPayload } from './types.js';

export interface SimpleQWebhookContext {
  req: Request;
  res: Response;
}

export type SimpleQWebhookHandler = (
  job: WebhookPayload,
  ctx: SimpleQWebhookContext,
) => unknown | Promise<unknown>;

/**
 * An Express handler that verifies the SimpleQ signature, parses the job, and runs `handler`.
 * Mount it directly on a `POST` route — it captures the raw request body itself.
 *
 * Outcome → response: the handler resolves → `200`; it throws `SimpleQBackpressure` → that
 * status + `Retry-After`; it throws anything else → `500`; bad signature → `401`. In ack mode,
 * resolve quickly (kick off background work) and report the outcome later via the client.
 */
export function simpleqWebhook(signingSecret: string, handler: SimpleQWebhookHandler): RequestHandler {
  const captureRawBody = express.raw({ type: '*/*' });

  const handle = async (req: Request, res: Response): Promise<void> => {
    let job: WebhookPayload;
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from((req.body as string) ?? '');
      job = constructEvent(body, req.header(SIGNATURE_HEADER), signingSecret);
    } catch (err) {
      if (err instanceof SignatureVerificationError) {
        res.status(401).end();
        return;
      }
      throw err;
    }

    try {
      await handler(job, { req, res });
      if (!res.headersSent) res.status(200).end();
    } catch (err) {
      if (res.headersSent) return;
      if (err instanceof SimpleQBackpressure) {
        if (err.retryAfter != null) res.set('Retry-After', String(err.retryAfter));
        res.status(err.status).end();
        return;
      }
      res.status(500).end();
    }
  };

  return (req, res, next) => {
    captureRawBody(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      void handle(req, res);
    });
  };
}
