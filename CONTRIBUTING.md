# Contributing

Thanks for helping improve the SimpleQ SDK.

## Development

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm test          # vitest suite
pnpm type-check    # tsc --noEmit
pnpm build         # tsup (ESM + CJS + types) + a declaration-file audit
```

## What CI enforces

Every PR runs four checks:

- **type-check** — `tsc --noEmit` over src and tests.
- **build** — the tsup build plus an audit of the emitted `.d.ts` files.
- **test** — the vitest suite.
- **contract** — the SDK's types are verified against SimpleQ's published OpenAPI spec
  (`https://docs.simpleq.io/openapi.json`). Run it locally with `pnpm check:contract`.
  If this fails on your PR, your change doesn't match the live API contract — the SDK's
  request/response types must stay assignable to what the API actually serves.

## Releases

Maintainers publish to npm from `main` via version tags.
