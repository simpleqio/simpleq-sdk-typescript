import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Mirror tsup's define so `__SDK_VERSION__` resolves to the package.json version under tests too.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: { __SDK_VERSION__: JSON.stringify(version) },
});
