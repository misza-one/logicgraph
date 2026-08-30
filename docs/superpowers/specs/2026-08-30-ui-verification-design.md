# UI-TDD Verification Design

## Goal

Add a minimal UI verification loop for LogicGraph contracts:

1. Scaffold one Playwright spec per UI contract.
2. Record the generated spec as `tests:` evidence in the contract YAML.
3. Run those specs through the application's own Playwright installation.
4. Report verification status per UI contract.

LogicGraph remains the semantic source of truth. Playwright is an adapter for checking browser-observable behavior; it does not infer business intent.

## Scope

V1 adds two CLI commands:

```bash
logicgraph verify scaffold [UI-ID]
logicgraph verify run [UI-ID]
```

`scaffold` generates or updates deterministic Playwright specs.

`run` delegates to the user's project with `npx --no-install playwright test <specs...> --reporter=json` and maps results back to UI contracts.

## Non-Goals

- No bundled Playwright dependency in LogicGraph.
- No browser automation in `@logicgraph/core`.
- No app seeding or fixture framework.
- No domain assertions such as `field-value`, `state-equals`, or `event-emitted`.
- No LLM inference, generated business rules, MCP server, or UI.
- No new package yet; keep this in the current monorepo modules until adapter complexity justifies extraction.

## Configuration

Extend `.logicgraph/config.yaml` with optional verification config:

```yaml
verify:
  baseUrl: http://localhost:3443
  specDir: tests/logicgraph
  pages:
    InvoiceDetails: /invoices/fixture-paid
```

Rules:

- `specDir` defaults to `tests/logicgraph`.
- `baseUrl` is required for `verify run`, not for `verify scaffold`.
- `pages[contract.page]` is required to generate a runnable spec.
- If a route is missing, scaffold reports `needs-route` and does not generate a broken spec.
- Generated specs navigate with `new URL(route, process.env.LOGICGRAPH_BASE_URL).toString()`; the CLI sets that environment variable from `verify.baseUrl` during `verify run`.

`scenario.given` is not used for seeding in V1. The configured route is responsible for putting the application into the required fixture state. Contracts with `scenarios[]` are reported as `partial` until scenario-specific `when`/`then` execution is implemented.

## Architecture

Keep the implementation split small:

- `@logicgraph/core`
  - Loads UI contracts.
  - Loads and validates `verify` config defaults.
  - Builds scaffold/run plans.
  - Generates deterministic spec text.
  - Classifies contracts as runnable, partial, or needing routes.

- `@logicgraph/cli`
  - Wires `verify scaffold` and `verify run` commands.
  - Writes generated spec files.
  - Updates `tests:` in UI contract YAML idempotently.
  - Executes `npx --no-install playwright test ... --reporter=json`.
  - Parses/report results and sets exit codes.

The boundary is:

```text
UIContract YAML
  -> VerificationPlan
  -> Generated Playwright spec
  -> CLI Playwright runner
  -> VerificationResult
```

Core owns semantic planning and spec generation. CLI owns filesystem mutation and subprocess execution.

## Assertion Vocabulary

Known `expected.type` values in V1:

```yaml
expected:
  - type: element-visible
    target: download_invoice_button

  - type: element-enabled
    target: download_invoice_button

  - type: text-visible
    text: Download

  - type: url-contains
    value: /invoices/
```

Locator rules:

- `target` means literal `data-testid` first, then CSS id fallback.
- `data-testid` keeps precedence for the full Playwright assertion timeout before falling back to CSS id.
- If `target` is omitted, use `contract.element`.
- Supported `contract.element.role + label` maps to `page.getByRole(role, { name: label })`; unsupported roles fall back to `contract.element.id`.
- `contract.element.id` maps to test id / CSS id fallback.
- If an assertion supplies `target` or `id`, it must be a non-empty string; malformed locator fields make the contract `partial` instead of falling back to a different element.
- If an assertion supplies an unsupported `role`, it is `partial` instead of forcing Playwright to throw on `getByRole`.

Unknown `expected.type` values:

- Scaffold emits a `not machine-verifiable` comment in the generated spec.
- `verify run` reports `partial` for that UI contract.
- Exit code is `1`; CI must not treat partial verification as fully green.

Trigger events `input`, `change`, and `select` are also partial in V1 because the current contract shape has no value to type/select; generated specs skip postconditions for those triggers so a correct UI is not failed by an interaction LogicGraph cannot perform. `click`, `toggle`, `submit`, and `navigate` are machine-actionable. `submit` uses `requestSubmit()` when the subject is a form and `click()` otherwise. Contracts with `scenarios[]` are partial because V1 does not execute scenario-specific `when`/`then` blocks.

## Scaffold Behavior

For each selected UI contract:

1. Resolve the page route from `verify.pages[contract.page]`.
2. Generate `specDir/<UI-ID>.spec.ts`.
3. Add that relative spec path to the contract's `tests:` array if missing.
4. Leave unrelated YAML content alone.

Generated specs include a small header marker with the UI contract ID. This keeps updates deterministic and lets `verify run` distinguish LogicGraph-generated specs from unrelated user tests.

Scaffold refuses to write through a symlink at the final generated spec path. Generated specs are regular files owned by LogicGraph; symlink support can be added later if a real use case appears.

Statuses:

- `generated`: spec written.
- `unchanged`: existing generated spec already matches.
- `needs-route`: no route for `contract.page`; no spec generated.
- `skipped`: deprecated contract or non-matching filter.

Example output:

```text
Scaffold UI verification

✓ UI-INVOICE-001  tests/logicgraph/UI-INVOICE-001.spec.ts
  updated: .logicgraph/ui-contracts/UI-INVOICE-001.yaml tests[]
```

## Run Behavior

`verify run [UI-ID]`:

1. Loads selected UI contracts.
2. Resolves the deterministic generated spec path (`specDir/<UI-ID>.spec.ts`) and confirms it is listed in the contract's `tests:` evidence.
3. Requires `verify.baseUrl`.
4. Refuses to run stale generated specs; users must rerun `verify scaffold` after contract changes.
5. Executes `LOGICGRAPH_BASE_URL=<baseUrl> PLAYWRIGHT_JSON_OUTPUT_NAME=<tmp-report> npx --no-install playwright test <specs...> --reporter=json`.
6. Reads the JSON report from the dedicated file so project stdout noise cannot corrupt parsing.
7. Fails all runnable contracts when the report contains Playwright runner errors such as global setup/teardown failures.
8. Maps Playwright JSON results back to UI contract IDs by spec filename, using the final retry outcome for each Playwright test.
9. Marks contracts with unknown assertion types as `partial` even when the Playwright spec passes.

`verify run` does not execute arbitrary paths from `tests:`. Other user-authored tests remain evidence for impact/doctor, but the verification runner only owns generated specs under `specDir`.

Statuses:

- `passed`: all known assertions pass and no unknown expected types exist.
- `failed`: Playwright reports failure for the contract spec.
- `partial`: at least one unknown `expected.type` is present.
- `skipped`: contract has no runnable spec for the selected filter.

Exit code:

- `0` only when every selected/runnable contract is `passed`.
- `1` for `failed`, `partial`, `needs-route`, missing `baseUrl`, missing spec, missing Playwright, invalid contract ID, or subprocess failure.

Example output:

```text
Verify UI contracts

✓ UI-INVOICE-001  passed
⚠ UI-PROFILE-001  partial: unknown expected type "profile-saved"
✗ UI-CHECKOUT-001 failed
```

## Testing

Core tests:

- Verify config defaults and validation.
- Generated spec output is deterministic.
- Known expected types generate the expected Playwright assertions.
- Unknown expected types classify the contract as partial.
- Missing page routes classify as `needs-route` and do not generate specs.

CLI tests:

- `verify scaffold` writes a spec and updates `tests:`.
- Scaffold is idempotent.
- `verify run` maps mocked Playwright JSON to contract statuses.
- Missing Playwright, missing `baseUrl`, or missing specs produce exit code `1` and readable errors.

Normal CI does not install or run real Playwright yet. The runner is tested with mocked subprocess output. Real Playwright smoke testing remains manual until there is a lightweight deterministic fixture app.

## Deferred Work

- Separate `@logicgraph/playwright` package.
- Fixture/seeding hooks for `scenario.given`.
- Custom assertion hooks.
- Domain-level assertions.
- Generated test migration/update strategy across schema changes.
- A single shortcut command that scaffolds and runs in one step.
