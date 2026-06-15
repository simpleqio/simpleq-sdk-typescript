import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Single source of truth for the version — see src/client.ts (__SDK_VERSION__).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    webhooks: 'src/webhooks.ts',
    express: 'src/express.ts',
    nest: 'src/nest.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
  treeshake: true,
  define: { __SDK_VERSION__: JSON.stringify(version) },
  // Framework integrations stay external — they're optional peer dependencies.
  external: ['express', '@nestjs/common', 'rxjs', 'reflect-metadata'],
});
