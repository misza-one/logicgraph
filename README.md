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
- `logicgraph impact <field|rule|ui-contract>`
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

Build the CLI, then run it in another repository:

```bash
node packages/cli/dist/src/index.js init
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
node packages/cli/dist/src/index.js rules validate
```

Check project health:

```bash
node packages/cli/dist/src/index.js doctor
```

Show everything connected to a field, rule, or UI contract:

```bash
node packages/cli/dist/src/index.js impact invoice.downloadAllowed
node packages/cli/dist/src/index.js impact RULE-BILLING-001
node packages/cli/dist/src/index.js impact UI-INVOICE-001
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

## Planned next steps

1. CodeGraph adapter
2. UI/Playwright verification
3. MCP server
4. LLM-assisted rule discovery

## Architectural principle

LogicGraph must never silently turn an AI inference into trusted application intent. AI-discovered rules start as `proposed`; reviewed rules may become `active`.
