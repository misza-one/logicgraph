# Changelog

All notable changes to LogicGraph are tracked here.

## Unreleased

### Changed

- `logicgraph impact` and `logicgraph context` keep exact query matches first, then fall back to case-insensitive substring matching over rule/UI IDs, titles, field labels, UI pages, and UI element labels.
- `logicgraph impact` and `logicgraph context` report ambiguous fuzzy queries with candidate matches and a rerun hint instead of choosing the first match silently.
- `logicgraph --version` now reads the CLI package version instead of using a stale hardcoded value.
- npm packages publish only runtime build output instead of TypeScript source, tests, and package-local config.

## 0.1.1 - 2026-08-31

### Added

- `logicgraph context <query>` for agent-friendly Markdown context.
- Public `examples/invoice-download` fixture for docs, demos, and CI smoke tests.

### Changed

- CI now smoke-tests the public example with `doctor`, `rules validate`, `impact`, `context`, `verify scaffold`, and scaffold idempotence.

## 0.1.0 - 2026-08-31

### Added

- First public npm release of `@logicgraph/core` and `@logicgraph/cli`.
- YAML schemas and validation for business rules and UI contracts.
- CLI commands for project init, doctor checks, rule validation, impact analysis, and UI verification scaffolding/runs.
- Optional CodeGraph-backed technical impact enrichment.
