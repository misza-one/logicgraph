# LogicGraph

LogicGraph is a version-controlled behavior layer for AI coding agents.

**Code tells an agent how an application works. LogicGraph tells it what the application is supposed to do and why.**

The project is being built around four linked concepts:

- business rules
- UI contracts
- user journeys
- tests as verification evidence

The source of truth is human-readable YAML stored in Git. Code intelligence, graph databases, MCP, and LLM-assisted discovery are integration layers that come later.

## Current milestone

The current milestone intentionally keeps the foundation small:

- TypeScript + pnpm monorepo
- `@logicgraph/core`
- structured `BusinessRule` schema with Zod
- structured `UIContract` schema with Zod
- nested `all`, `any`, and `not` conditions
- `@logicgraph/cli`
- `logicgraph init`
- `logicgraph rules validate`
- `logicgraph doctor`
- `logicgraph impact <query>`
- `logicgraph context <query>`
- unit tests

## Development

Requirements:

- Node.js 22.12+
- pnpm

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Use the published CLI in another repository:

```bash
npm exec --yes --package @logicgraph/cli -- logicgraph doctor
```

For local development, build the CLI, then run it in another repository. Set the path to the LogicGraph checkout once:

```bash
LOGICGRAPH_DIR=/path/to/logicgraph
```

```bash
node "$LOGICGRAPH_DIR/packages/cli/dist/src/index.js" init
```

This creates:

```text
.logicgraph/
├── config.yaml
├── rules/
├── ui-contracts/
└── journeys/
```

Running `init` again will refuse to overwrite the existing config unless `--force` is supplied.

Validate rule YAML:

```bash
node "$LOGICGRAPH_DIR/packages/cli/dist/src/index.js" rules validate
```

Check project health:

```bash
node "$LOGICGRAPH_DIR/packages/cli/dist/src/index.js" doctor
```

Show everything downstream of a field, rule, UI contract, or matching title/page text:

```bash
node "$LOGICGRAPH_DIR/packages/cli/dist/src/index.js" impact InvoiceDetails
node "$LOGICGRAPH_DIR/packages/cli/dist/src/index.js" impact invoice.downloadAllowed
node "$LOGICGRAPH_DIR/packages/cli/dist/src/index.js" impact RULE-BILLING-001
node "$LOGICGRAPH_DIR/packages/cli/dist/src/index.js" impact UI-INVOICE-001
```

Exact IDs and field names win first. If there is no exact match, queries fall back to case-insensitive substring matching over rule titles, UI titles, field names, UI pages, and UI element labels. Broad fuzzy queries print candidate matches and a rerun hint instead of guessing.

Impact is directional: changing a field affects the rules that read it, a rule change affects the fields it writes and the UI contracts that require it. Tests and implementation references are shown as evidence but never propagate impact further (two rules sharing a test do not affect each other). Add `--code` to enrich implementation references with technical symbol impact from the [CodeGraph](https://github.com/oraios/serena) CLI:

```bash
node "$LOGICGRAPH_DIR/packages/cli/dist/src/index.js" impact invoice.downloadAllowed --code
```

Semantic impact never depends on CodeGraph being installed or initialized; enrichment failures are reported as warnings while the semantic result stays complete. Enrichment queries the existing CodeGraph index — run `codegraph sync` explicitly when you want to refresh it, `logicgraph impact` will never index your repository behind your back.

Print Markdown context for an AI coding agent before editing a behavior:

```bash
node "$LOGICGRAPH_DIR/packages/cli/dist/src/index.js" context InvoiceDetails
node "$LOGICGRAPH_DIR/packages/cli/dist/src/index.js" context RULE-BILLING-001
```


## Example business rule

```yaml
id: RULE-BILLING-001
title: Paid customer may download invoice
domain: billing
type: decision
status: active

when:
  all:
    - field: subscription.status
      operator: eq
      value: ACTIVE
    - field: payment.status
      operator: eq
      value: PAID

then:
  - action: set
    field: invoice.downloadAllowed
    value: true

implementation:
  - src/billing/InvoiceService.ts#canDownload

tests:
  - tests/billing/invoice-download.spec.ts

uiContracts:
  - UI-INVOICE-001

createdAt: 2026-08-22
updatedAt: 2026-08-22
```

## Example UI contract

```yaml
id: UI-INVOICE-001
title: Download invoice button
status: active
page: InvoiceDetails

element:
  id: download_invoice_button
  role: button
  label: Download invoice

trigger:
  event: click

requires:
  - RULE-BILLING-001

implementation:
  - src/billing/InvoiceDetails.tsx#DownloadInvoiceButton

tests:
  - tests/billing/invoice-download.spec.ts
```

The impact graph links rules, UI contracts, fields, implementation references, and tests in memory. It is intentionally local and ephemeral; persistence and external graph adapters come later.

Generate UI verification specs from UI contracts:

```yaml
# .logicgraph/config.yaml
verify:
  baseUrl: http://localhost:3443
  specDir: tests/logicgraph
  pages:
    InvoiceDetails: /invoices/fixture-paid
```

```bash
node "$LOGICGRAPH_DIR/packages/cli/dist/src/index.js" verify scaffold UI-INVOICE-001
node "$LOGICGRAPH_DIR/packages/cli/dist/src/index.js" verify run UI-INVOICE-001
```

`verify scaffold` writes `tests/logicgraph/<UI-ID>.spec.ts` and records it in the contract's `tests:` evidence. `verify run` delegates to the application's own local Playwright binary via `node_modules/.bin/playwright test --reporter=json -- ...`; LogicGraph does not bundle Playwright.

See `examples/invoice-download` for a small public rule-to-UI-contract example that CI validates with `doctor`, `rules validate`, `impact`, `context`, and scaffold idempotence.

## Planned next steps

1. MCP server
2. LLM-assisted rule discovery
3. Optional `context --json` or `context --code` once a real consumer needs it

(CodeGraph enrichment of `logicgraph impact --code` shipped earlier; see above.)

## Architectural principle

LogicGraph must never silently turn an AI inference into trusted application intent. AI-discovered rules start as `proposed`; reviewed rules may become `active`.
