# Repository Guidelines

## Project Structure & Module Organization
LogicGraph is a pnpm TypeScript monorepo. Core domain logic lives in `packages/core/src`, including YAML loading, rule/UI-contract schemas, doctor checks, and impact graph logic. CLI command parsing and terminal output live in `packages/cli/src`. Tests sit beside each package in `packages/*/tests` and use `*.test.ts` names. Generated output goes to `packages/*/dist` and should stay build-produced, not hand-edited.

## Build, Test, and Development Commands
- `pnpm install` — install workspace dependencies; use the locked pnpm version from `package.json`.
- `pnpm typecheck` — run TypeScript checks for all packages.
- `pnpm test` — run all Vitest suites.
- `pnpm build` — compile both packages to `dist`.
- `node packages/cli/dist/src/index.js <command>` — run the built CLI locally, for example `doctor`, `rules validate`, or `impact RULE-BILLING-001`.

Node.js `>=22.13 <23 || >=23.4` is required. CI runs install, typecheck, tests, then build.

## Coding Style & Naming Conventions
Use strict TypeScript with ES modules (`type: module`, `moduleResolution: NodeNext`). Keep domain behavior in `@logicgraph/core`; keep printing, exit codes, and Commander wiring in `@logicgraph/cli`. Prefer small exported functions over new abstractions. Use two-space indentation, double quotes, semicolons, and descriptive camelCase function names. Rule IDs and UI contract IDs should follow examples such as `RULE-BILLING-001` and `UI-INVOICE-001`.

## Testing Guidelines
Use Vitest (`vitest run`). Add or update the smallest relevant test when behavior changes, especially for schema validation, path handling, CLI output, and impact traversal. Keep fixtures inline or temporary unless shared across multiple tests. No coverage threshold is configured; passing `pnpm test` and `pnpm typecheck` is the minimum bar.

## Commit & Pull Request Guidelines
Recent history uses Conventional Commit prefixes such as `feat:`, `fix:`, and `docs:`. Keep commits scoped and explain the behavior change, not just the file touched. PRs should include a short summary, test evidence (`pnpm typecheck`, `pnpm test`, `pnpm build`), linked issue when applicable, and CLI output screenshots or snippets when terminal behavior changes.

## Architecture Notes
Human-authored `.logicgraph/*.yaml` is the semantic source of truth. CodeGraph and other code-intelligence integrations may enrich output, but semantic impact must remain correct when they are unavailable.
