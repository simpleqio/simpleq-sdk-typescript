// Guards the published type surface: fails the build if the bundled .d.ts files
// either still reference the private @simpleq/types package (inlining failed) or
// leak any internal-only symbol. Wired into `build` and runnable via `audit:dts`.
import { readdir, readFile } from 'node:fs/promises';

const DIST = new URL('../dist/', import.meta.url);

// Internal-only identifiers that must never appear in the public declarations.
// (Deliberately excludes `signingSecret`, which is a legitimate public option on
// the Nest `SimpleQModule.forRoot` config.)
const FORBIDDEN = [
  'keyHash',
  'ApiKey',
  'Organization',
  'workosOrgId',
  'revokedAt',
  'AckChannelMessage',
  'BullJobData',
  'DeadLetterJob',
  'CreateApiKey',
];

let entries;
try {
  entries = await readdir(DIST);
} catch {
  console.error('audit:dts — dist/ not found. Run the build first.');
  process.exit(1);
}

const dtsFiles = entries.filter((f) => f.endsWith('.d.ts') || f.endsWith('.d.cts'));
if (dtsFiles.length === 0) {
  console.error('audit:dts — no declaration files in dist/. Did the build emit types?');
  process.exit(1);
}

let failed = false;
for (const file of dtsFiles) {
  const text = await readFile(new URL(file, DIST), 'utf8');

  if (/['"(]@simpleq\/types['")]/.test(text)) {
    console.error(`audit:dts — ${file} still references @simpleq/types (noExternal inlining failed).`);
    failed = true;
  }

  for (const sym of FORBIDDEN) {
    if (new RegExp(`\\b${sym}\\w*\\b`).test(text)) {
      console.error(`audit:dts — ${file} leaks an internal symbol matching "${sym}".`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('audit:dts — FAILED: published .d.ts contains internal/private references.');
  process.exit(1);
}
console.log(`audit:dts — OK (${dtsFiles.length} declaration files clean).`);
