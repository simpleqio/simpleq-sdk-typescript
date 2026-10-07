# SimpleQ TypeScript SDK

These instructions apply to coding agents and contributors working in this repository. No other SimpleQ repositories or local workspace files are required.

## Start here

- Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, verification, and release conventions.
- This repository publishes `@simpleq/sdk` for Node 22+, with ESM, CommonJS, and TypeScript declarations.
- Follow the existing code style and keep changes focused on the requested task.

## API compatibility

- The [published SimpleQ OpenAPI contract](https://docs.simpleq.io/openapi.json) is the source of truth for API request and response shapes.
- Do not add SDK behavior that the SimpleQ API does not support.
- Preserve public exports, method signatures, error behavior, and compatibility across ESM, CommonJS, and TypeScript declarations. Identify intentional breaking changes explicitly for maintainer review.
- If an API change is required, coordinate it with maintainers before treating the SDK change as ready. The published contract must support the change.

## Verification

- For code changes, run all four checks documented in [CONTRIBUTING.md](CONTRIBUTING.md): type-check, build (including the declaration audit), tests, and the OpenAPI contract check.
- Add or update tests for behavior changes and update customer-facing documentation when usage changes.
- For documentation-only changes, check accuracy, links, and formatting; code checks can be skipped unless the documentation changes development or verification instructions.
- Report which checks ran and their results. If a check is blocked or fails, state why; do not claim it passed or bypass it to make the change appear ready.

## Safety and releases

- Never read, print, or commit secrets from `.env` files or credential stores. Use placeholders in documentation and tests.
- Do not push, merge, create release tags, or publish packages without explicit maintainer authorization.
- Leave version changes and releases to the maintainer-approved release process. Documentation-only changes do not require an npm release.
