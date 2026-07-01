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
const FETCH_TIMEOUT_MS = 20_000;
const root = fileURLToPath(new URL('..', import.meta.url));

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// One fetch attempt. Returns {schema, hash} on 2xx, or null on ANY failure (network error,
// timeout, non-2xx, or unparseable body) so callers can retry — a 15-minute poll must not
// die on a single transient blip. Hashes the raw (decompressed) JSON bytes so the digest
// matches the platform's `curl | sha256sum` (both hash the same uncompressed bytes).
async function tryFetchSpec(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`check-contract — GET ${url} → HTTP ${res.status}; will retry`);
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return { schema: JSON.parse(bytes.toString('utf8')), hash: sha256(bytes) };
  } catch (err) {
    console.warn(`check-contract — GET ${url} failed: ${err?.cause?.code ?? err?.message ?? err}; will retry`);
    return null;
  }
}

// Single definitive fetch (PR / push / cron path). Retries a few times to ride out transient
// network blips, then fails hard if the spec is genuinely unreachable.
async function fetchSpecOrExit(url, attempts = 5, gapMs = 3_000) {
  for (let i = 1; i <= attempts; i++) {
    const r = await tryFetchSpec(url);
    if (r) return r.schema;
    if (i < attempts) await sleep(gapMs);
  }
  console.error(`check-contract — could not fetch spec from ${url} after ${attempts} attempts`);
  process.exit(1);
}

// Waits for the docs deploy to publish the new spec, then returns it. Baseline = the
// platform's pre-deploy hash when it matches our first observation (proving the hashes are
// comparable and the spec is still the old one); otherwise we fall back to our own first
// observation, so a cross-tool hash mismatch can never make us assert the OLD spec by mistake.
// Transient fetch failures are tolerated (retry next tick); we only conclude at the cap — assert
// the last good spec if we ever saw one, else fail (15m unreachable = a real problem). The
// weekly cron is the correctness backstop.
async function fetchSpecAfterDeploy(url, prevSha) {
  const CAP_MS = 15 * 60_000;
  const INTERVAL_MS = 15_000;
  const start = Date.now();
  let baseline = null;
  let lastGood = null;
  console.log('check-contract — waiting for the new spec to publish (up to 15m)');
  for (;;) {
    const r = await tryFetchSpec(url);
    if (r) {
      lastGood = r;
      if (baseline === null) {
        baseline = r.hash === prevSha ? prevSha : r.hash;
        console.log(`check-contract — baseline ${baseline.slice(0, 12)}…; waiting for it to change`);
      } else if (r.hash !== baseline) {
        console.log(`check-contract — new spec published after ~${Math.round((Date.now() - start) / 1000)}s`);
        return r.schema;
      }
    }
    if (Date.now() - start >= CAP_MS) {
      if (lastGood) {
        console.warn(
          'check-contract — spec unchanged after 15m; asserting against the current live spec (weekly cron is the backstop)',
        );
        return lastGood.schema;
      }
      console.error(`check-contract — could not fetch spec from ${url} within the 15m window`);
      process.exit(1);
    }
    await sleep(INTERVAL_MS);
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
  schema = prevSha ? await fetchSpecAfterDeploy(source, prevSha) : await fetchSpecOrExit(source);
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
