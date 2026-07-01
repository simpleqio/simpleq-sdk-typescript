// Contract check: generates TypeScript types from the published SimpleQ OpenAPI spec
// and type-checks contract/assertions.ts, which asserts two-way assignability between
// the generated types and this SDK's hand-written shapes. Drift in either direction is
// a hard failure. Spec source precedence:
//   SIMPLEQ_OPENAPI_PATH (local file) > SIMPLEQ_OPENAPI_URL > https://docs.simpleq.io/openapi.json
//
// When fired by the platform's `contract-changed` repository_dispatch, SIMPLEQ_PREV_SPEC_SHA256
// carries the sha256 of the spec that was published BEFORE the platform's docs deploy. We then
// poll the live spec until its hash differs (the new deploy landed) before asserting, so we
// always check the NEW contract. The platform no longer waits for its own deploy (that
// deadlocked it) — the wait lives here, in the consumer that needs the fresh spec.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import openapiTS, { astToString } from 'openapi-typescript';

const DEFAULT_URL = 'https://docs.simpleq.io/openapi.json';
const root = fileURLToPath(new URL('..', import.meta.url));

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Fetches the spec once. Hashes the raw (decompressed) JSON bytes so the digest matches the
// platform's `curl | sha256sum` (both hash the same uncompressed bytes).
async function fetchSpec(url) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`check-contract — failed to fetch spec from ${url}: HTTP ${res.status}`);
    process.exit(1);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return { schema: JSON.parse(bytes.toString('utf8')), hash: sha256(bytes) };
}

// Waits for the docs deploy to publish the new spec, then returns it. Baseline = the
// platform's pre-deploy hash when it matches our first observation (proving the hashes are
// comparable and the spec is still the old one); otherwise we fall back to our own first
// observation, so a cross-tool hash mismatch can never make us assert the OLD spec by
// mistake. Bounded; on timeout we assert against whatever's live (the weekly cron is the
// correctness backstop).
async function fetchSpecAfterDeploy(url, prevSha) {
  const CAP_MS = 15 * 60_000;
  const INTERVAL_MS = 15_000;
  const start = Date.now();
  let latest = await fetchSpec(url);
  const baseline = latest.hash === prevSha ? prevSha : latest.hash;
  console.log(
    `check-contract — waiting for the new spec to publish (baseline ${baseline.slice(0, 12)}…, up to 15m)`,
  );
  for (;;) {
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (latest.hash !== baseline) {
      console.log(`check-contract — new spec published after ~${elapsed}s`);
      return latest.schema;
    }
    if (Date.now() - start >= CAP_MS) {
      console.warn(
        `check-contract — spec unchanged after ${elapsed}s; asserting against the current live spec (weekly cron is the backstop)`,
      );
      return latest.schema;
    }
    await sleep(INTERVAL_MS);
    latest = await fetchSpec(url);
  }
}

let source;
let schema;
if (process.env.SIMPLEQ_OPENAPI_PATH) {
  source = process.env.SIMPLEQ_OPENAPI_PATH;
  schema = JSON.parse(await readFile(source, 'utf8'));
} else {
  source = process.env.SIMPLEQ_OPENAPI_URL ?? DEFAULT_URL;
  const prevSha = process.env.SIMPLEQ_PREV_SPEC_SHA256;
  schema = prevSha ? await fetchSpecAfterDeploy(source, prevSha) : (await fetchSpec(source)).schema;
}

const ast = await openapiTS(schema);
const code = astToString(ast);

await mkdir(new URL('../contract/.generated/', import.meta.url), { recursive: true });
await writeFile(new URL('../contract/.generated/spec.ts', import.meta.url), code);

try {
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'contract/tsconfig.json'], {
    stdio: 'inherit',
    cwd: root,
  });
} catch {
  console.error(`check-contract — FAILED: SDK types have drifted from the spec at ${source}`);
  console.error(
    'The failing assertion lines above name the drifted shapes. See CONTRIBUTING.md ("What CI enforces").',
  );
  process.exit(1);
}
console.log(`check-contract — OK: SDK types match the spec at ${source}`);
