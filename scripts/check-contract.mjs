// Contract check: generates TypeScript types from the published SimpleQ OpenAPI spec
// and type-checks contract/assertions.ts, which asserts two-way assignability between
// the generated types and this SDK's hand-written shapes. Drift in either direction is
// a hard failure. Spec source precedence:
//   SIMPLEQ_OPENAPI_PATH (local file) > SIMPLEQ_OPENAPI_URL > https://docs.simpleq.io/openapi.json
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const DEFAULT_URL = 'https://docs.simpleq.io/openapi.json';
const root = fileURLToPath(new URL('..', import.meta.url));

let source;
let schema;
if (process.env.SIMPLEQ_OPENAPI_PATH) {
  source = process.env.SIMPLEQ_OPENAPI_PATH;
  schema = JSON.parse(await readFile(source, 'utf8'));
} else {
  source = process.env.SIMPLEQ_OPENAPI_URL ?? DEFAULT_URL;
  const res = await fetch(source);
  if (!res.ok) {
    console.error(`check-contract — failed to fetch spec from ${source}: HTTP ${res.status}`);
    process.exit(1);
  }
  schema = await res.json();
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
