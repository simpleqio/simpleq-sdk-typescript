// Two-way assignability between the SDK's hand-written types and types generated from
// the published OpenAPI spec (contract/.generated/spec.ts, created by check-contract.mjs).
// If the platform changes the wire contract — or the SDK does — this file stops compiling.
import type { paths, webhooks } from './.generated/spec.js';
import type {
  Job,
  JobStatus,
  PublishJobRequest,
  PublishJobResponse,
  WebhookPayload,
  AckResponse,
  NackOptions,
  DeferOptions,
} from '../src/types.js';

type Json<T> = T extends { content: { 'application/json': infer B } } ? B : never;
type Body<Op> = Json<NonNullable<Op extends { requestBody?: infer R } ? R : never>>;

// Two-way: catches added, removed, renamed, and retyped fields in either direction.
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

type PublishOp = paths['/v1/queues/{queueName}/jobs']['post'];
type GetJobOp = paths['/v1/jobs/{id}']['get'];
type AckOp = paths['/v1/jobs/{id}/ack']['post'];
type NackOp = paths['/v1/jobs/{id}/nack']['post'];
type DeferOp = paths['/v1/jobs/{id}/defer']['post'];
type DeliveryWebhook = webhooks['job-delivery']['post'];

type SpecJob = Json<GetJobOp['responses'][200]>;

type _ContractAssertions = [
  Expect<Mutual<PublishJobRequest, Body<PublishOp>>>,
  Expect<Mutual<PublishJobResponse, Json<PublishOp['responses'][201]>>>,
  Expect<Mutual<PublishJobResponse, Json<PublishOp['responses'][200]>>>,
  Expect<Mutual<Job, SpecJob>>,
  Expect<Mutual<JobStatus, SpecJob['status']>>,
  Expect<Mutual<AckResponse, Json<AckOp['responses'][200]>>>,
  Expect<Mutual<NackOptions, Body<NackOp>>>,
  Expect<Mutual<DeferOptions, Body<DeferOp>>>,
  Expect<Mutual<WebhookPayload, Body<DeliveryWebhook>>>,
];

export {};
