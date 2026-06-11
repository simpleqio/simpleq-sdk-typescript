import { defineConfig } from 'tsup';

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
  // Framework integrations stay external — they're optional peer dependencies.
  external: ['express', '@nestjs/common', 'rxjs', 'reflect-metadata'],
});
