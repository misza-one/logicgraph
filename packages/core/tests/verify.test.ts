import { mkdir, symlink, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildUiVerificationPlan,
  generateUiVerificationSpec,
  hasGeneratedSpecEvidence,
  logicGraphConfigSchema,
  unknownVerificationReasons,
  type UIContract,
} from "../src/index.js";

describe("UI verification core", () => {
  it("loads verify config defaults", () => {
    expect(logicGraphConfigSchema.parse({
      version: 1,
      rules: "rules",
      uiContracts: "ui-contracts",
      journeys: "journeys",
    }).verify).toEqual({ specDir: "tests/logicgraph", pages: {} });

    expect(logicGraphConfigSchema.parse({
      version: 1,
      rules: "rules",
      uiContracts: "ui-contracts",
      journeys: "journeys",
      verify: { pages: { InvoiceDetails: "/invoices/fixture-paid" } },
    }).verify).toEqual({ specDir: "tests/logicgraph", pages: { InvoiceDetails: "/invoices/fixture-paid" } });
  });

  it("rejects unusable verify URLs", () => {
    for (const baseUrl of ["localhost:3443", "/relative", "mailto:test@example.com", "http:foo", "https:foo"]) {
      expect(logicGraphConfigSchema.safeParse({
        version: 1,
        rules: "rules",
        uiContracts: "ui-contracts",
        journeys: "journeys",
        verify: { baseUrl },
      }).success).toBe(false);
    }

    for (const baseUrl of ["http://localhost:3443", "https://localhost:3443"]) {
      for (const route of ["http:foo", "https:foo", "app:invoice", "//example.com/invoice"]) {
        expect(logicGraphConfigSchema.safeParse({
          version: 1,
          rules: "rules",
          uiContracts: "ui-contracts",
          journeys: "journeys",
          verify: { baseUrl, pages: { InvoiceDetails: route } },
        }).success).toBe(false);
      }
    }

    expect(logicGraphConfigSchema.safeParse({
      version: 1,
      rules: "rules",
      uiContracts: "ui-contracts",
      journeys: "journeys",
      verify: { pages: { InvoiceDetails: "http://[" } },
    }).success).toBe(false);
  });

  it("classifies contracts without page routes as needs-route", async () => {
    const cwd = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\n");
    await writeContract(cwd, contractYaml());

    const plan = await buildUiVerificationPlan({ cwd });

    expect(plan.specDir).toBe("tests/logicgraph");
    expect(plan.items).toMatchObject([{
      status: "needs-route",
      specRelativePath: "tests/logicgraph/UI-INVOICE-001.spec.ts",
      reason: "missing verify.pages.InvoiceDetails",
    }]);
    expect(plan.items[0].spec).toBeUndefined();
  });

  it("does not treat inherited page names as configured routes", async () => {
    const cwd = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\n");
    await writeContract(cwd, contractYaml().replace("page: InvoiceDetails", "page: toString"));

    const plan = await buildUiVerificationPlan({ cwd });

    expect(plan.items).toMatchObject([{ status: "needs-route", reason: "missing verify.pages.toString" }]);
    expect(plan.items[0].spec).toBeUndefined();
  });

  it("generates deterministic specs for known browser-observable assertions", () => {
    const spec = generateUiVerificationSpec(contract(), "/invoices/fixture-paid");

    expect(spec).toContain("// logicgraph-ui-contract: UI-INVOICE-001");
    expect(spec).toContain("process.env.LOGICGRAPH_BASE_URL");
    expect(spec).toContain("await page.goto(new URL(route, baseUrl).toString());");
    expect(spec).toContain('const subject = page.getByRole("button" as never, { name: "Download" });');
    expect(spec).toContain("await subject.click();");
    expect(spec).toContain('page.locator(`[data-testid="${value}"]`);');
    expect(spec).toContain("function cssString(value: string): string");
    expect(spec).not.toContain("getByTestId");
    expect(spec).toContain("await expect(byTestId).toBeAttached();");
    expect(spec).toContain('await expectTextVisible(page, "Download");');
    expect(spec).toContain("await expect.poll(async () => {");
    expect(spec).toContain('await expect(page).toHaveURL(new RegExp("/invoices/"));');
    expect(spec).not.toContain("not machine-verifiable");
  });

  it("uses CSS string escaping for target selectors", () => {
    const ui = { ...contract(), expected: [{ type: "element-enabled", target: "download\ninvoice" }] };
    const spec = generateUiVerificationSpec(ui, "/reports");

    expect(spec).toContain('await findByTarget(page, "download\\ninvoice");');
    expect(spec).toContain("const value = cssString(target);");
    expect(spec).toContain("return `\\\\${char.charCodeAt(0).toString(16)} `;");
  });

  it("falls back to target lookup for unsupported element roles", () => {
    const base = contract();
    const ui = { ...base, element: { ...base.element, role: "chart" } };
    const spec = generateUiVerificationSpec(ui, "/reports");

    expect(spec).toContain('const subject = await findByTarget(page, "download_invoice_button");');
    expect(spec).not.toContain('getByRole("chart"');
  });

  it("scopes text-visible assertions when they include locator fields", () => {
    const ui = { ...contract(), expected: [{ type: "text-visible", text: "Paid", target: "invoice_status" }] };
    const spec = generateUiVerificationSpec(ui, "/reports");

    expect(spec).toContain('const expected0 = await findByTarget(page, "invoice_status");');
    expect(spec).toContain('await expectTextVisible(expected0, "Paid");');
    expect(spec).not.toContain('await expectTextVisible(page, "Paid");');
  });

  it("honors role-only assertion locators", () => {
    const ui = { ...contract(), element: { id: "download_invoice_button", role: "button" }, expected: [{ type: "element-visible", role: "alert" }] };
    const spec = generateUiVerificationSpec(ui, "/reports");

    expect(spec).toContain('const expected0 = page.getByRole("alert" as never);');
    expect(spec).not.toContain('getByRole("alert" as never, { name:');
  });

  it("marks unsupported assertion roles as partial", () => {
    const ui = { ...contract(), expected: [{ type: "element-visible", role: "chart", label: "Revenue" }] };
    const fallbackRole = { ...contract(), element: { id: "download_invoice_button", role: "chart" }, expected: [{ type: "element-visible", label: "Revenue" }] };
    const spec = generateUiVerificationSpec(ui, "/reports");

    expect(unknownVerificationReasons(ui)).toEqual(['expected field "role" uses unsupported Playwright ARIA role "chart"']);
    expect(unknownVerificationReasons(fallbackRole)).toEqual(['expected field "label" cannot use unsupported fallback role "chart"']);
    expect(spec).toContain('not machine-verifiable: expected field "role" uses unsupported Playwright ARIA role "chart"');
    expect(spec).not.toContain("const expected0");
  });

  it("marks unknown expected types as partial and comments them in the spec", () => {
    const ui = { ...contract(), expected: [{ type: "profile-saved" }] };

    expect(unknownVerificationReasons(ui)).toEqual(['unknown expected type "profile-saved"']);
    expect(generateUiVerificationSpec(ui, "/profile")).toContain('not machine-verifiable: unknown expected type "profile-saved"');
  });

  it("marks malformed assertion targets as partial", () => {
    const ui = { ...contract(), expected: [{ type: "element-visible", target: null }] };
    const spec = generateUiVerificationSpec(ui, "/profile");

    expect(unknownVerificationReasons(ui)).toEqual(['expected field "target" must be a non-empty string']);
    expect(spec).toContain('not machine-verifiable: expected field "target" must be a non-empty string');
    expect(spec).not.toContain("const expected0");
  });

  it("marks malformed assertion locator fields as partial for every assertion type", () => {
    const role = { ...contract(), expected: [{ type: "element-visible", role: null }] };
    const label = { ...contract(), expected: [{ type: "element-visible", label: "" }] };
    const textTarget = { ...contract(), expected: [{ type: "text-visible", text: "Download", target: null }] };
    const urlTarget = { ...contract(), expected: [{ type: "url-contains", value: "/invoices/", target: "invoice_status" }] };
    const mixed = { ...contract(), expected: [{ type: "element-visible", target: "save", role: "alert" }] };
    const duplicate = { ...contract(), expected: [{ type: "element-visible", target: "save", id: "submit" }] };

    expect(unknownVerificationReasons(role)).toEqual(['expected field "role" must be a non-empty string']);
    expect(unknownVerificationReasons(label)).toEqual(['expected field "label" must be a non-empty string']);
    expect(unknownVerificationReasons(textTarget)).toEqual(['expected field "target" must be a non-empty string']);
    expect(unknownVerificationReasons(urlTarget)).toEqual(['expected type "url-contains" does not support locator fields in v1']);
    expect(unknownVerificationReasons(mixed)).toEqual(["expected locator fields must not mix target/id with role/label"]);
    expect(unknownVerificationReasons(duplicate)).toEqual(["expected locator fields must not specify both target and id"]);
  });

  it("escapes line breaks in not-machine-verifiable comments", () => {
    const ui = { ...contract(), expected: [{ type: "bad\nthrow new Error('boom')" }] };
    const spec = generateUiVerificationSpec(ui, "/profile");

    expect(spec).toContain('not machine-verifiable: unknown expected type "bad\\nthrow new Error');
    expect(spec).not.toContain("\nthrow new Error('boom')");
  });

  it("marks scenarios as partial until scenario assertions are implemented", () => {
    const ui = { ...contract(), expected: [], scenarios: [{ name: "paid invoice", given: {}, then: [{ type: "text-visible", text: "Download" }] }] };

    expect(unknownVerificationReasons(ui)).toEqual(['scenario "paid invoice" is not machine-verifiable in v1']);
    expect(generateUiVerificationSpec(ui, "/profile")).toContain('not machine-verifiable: scenario "paid invoice" is not machine-verifiable in v1');
  });

  it("skips postconditions when the trigger is not machine-actionable", () => {
    const ui = { ...contract(), trigger: { event: "input" as const } };
    const spec = generateUiVerificationSpec(ui, "/profile");

    expect(spec).toContain("postconditions skipped because the trigger is not machine-actionable in v1");
    expect(spec).not.toContain('await expectTextVisible(page, "Download");');
  });

  it("submits form subjects with requestSubmit", () => {
    const ui = { ...contract(), element: { id: "checkout_form", role: "form", label: "Checkout" }, trigger: { event: "submit" as const } };
    const spec = generateUiVerificationSpec(ui, "/checkout");

    expect(spec).toContain("element.requestSubmit();");
    expect(spec).not.toContain('subject.press("Enter")');
  });

  it("builds ready plans with route, spec path, and partial reasons", async () => {
    const cwd = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  baseUrl: http://localhost:3443\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(cwd, contractYaml());

    const plan = await buildUiVerificationPlan({ cwd, contractId: "UI-INVOICE-001" });

    expect(plan.baseUrl).toBe("http://localhost:3443");
    expect(plan.items).toMatchObject([{
      status: "ready",
      route: "/invoices/fixture-paid",
      specRelativePath: "tests/logicgraph/UI-INVOICE-001.spec.ts",
      partialReasons: [],
    }]);
    expect(plan.items[0].spec).toContain("UI-INVOICE-001: Download invoice button");
  });

  it("rejects specDir paths outside the repository", async () => {
    const cwd = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: ../outside\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(cwd, contractYaml());

    await expect(buildUiVerificationPlan({ cwd })).rejects.toThrow("verify.specDir ../outside is outside repository");

    const drivePrefix = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: 'C:'\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(drivePrefix, contractYaml());

    await expect(buildUiVerificationPlan({ cwd: drivePrefix })).rejects.toThrow("verify.specDir must be repository-relative");
  });

  it("allows the repository root as specDir", async () => {
    const cwd = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: .\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(cwd, contractYaml());

    const plan = await buildUiVerificationPlan({ cwd });

    expect(plan.items).toMatchObject([{ status: "ready", specRelativePath: "./UI-INVOICE-001.spec.ts" }]);
    expect(hasGeneratedSpecEvidence({ ...contract(), tests: ["UI-INVOICE-001.spec.ts"] }, cwd, ".")).toBe(true);
    expect(hasGeneratedSpecEvidence({ ...contract(), tests: ["tests\\logicgraph\\UI-INVOICE-001.spec.ts"] }, cwd, "tests/logicgraph")).toBe(true);

    const parent = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: tests/..\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(parent, contractYaml());

    const parentPlan = await buildUiVerificationPlan({ cwd: parent });

    expect(parentPlan.items).toMatchObject([{ status: "ready", specRelativePath: "./UI-INVOICE-001.spec.ts" }]);
  });

  it("rejects backslash traversal in specDir before path normalization", async () => {
    const cwd = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: ..\\outside\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(cwd, contractYaml());

    await expect(buildUiVerificationPlan({ cwd })).rejects.toThrow("verify.specDir ../outside is outside repository");
  });

  it("rejects specDir values that normalize to an empty path", async () => {
    const cwd = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: '\\\\'\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(cwd, contractYaml());

    await expect(buildUiVerificationPlan({ cwd })).rejects.toThrow("verify.specDir must not normalize to an empty path");
  });

  it("rejects specDir paths containing NUL bytes", async () => {
    const cwd = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: \"bad\\0dir\"\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(cwd, contractYaml());

    await expect(buildUiVerificationPlan({ cwd })).rejects.toThrow("verify.specDir must not contain NUL bytes");
  });

  it("rejects specDir paths with filesystem probe errors", async () => {
    const cwd = await project(`version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: ${"a".repeat(5000)}\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n`);
    await writeContract(cwd, contractYaml());

    await expect(buildUiVerificationPlan({ cwd })).rejects.toThrow("verify.specDir");
  });

  it("rejects specDir paths that are or contain regular files", async () => {
    const fileTarget = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: specs\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(fileTarget, contractYaml());
    await writeFile(join(fileTarget, "specs"), "not a directory", "utf8");

    await expect(buildUiVerificationPlan({ cwd: fileTarget })).rejects.toThrow("verify.specDir specs is not a directory");

    const fileAncestor = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: specs/nested\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(fileAncestor, contractYaml());
    await writeFile(join(fileAncestor, "specs"), "not a directory", "utf8");

    await expect(buildUiVerificationPlan({ cwd: fileAncestor })).rejects.toThrow("verify.specDir specs is not a directory");
  });

  it("rejects specDir symlinks that resolve outside the repository", async () => {
    const cwd = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: linked-specs\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(cwd, contractYaml());
    const outside = await mkdtemp(join(tmpdir(), "logicgraph-outside-"));
    await symlink(outside, join(cwd, "linked-specs"), "dir");

    await expect(buildUiVerificationPlan({ cwd })).rejects.toThrow("verify.specDir linked-specs resolves outside repository");

    const dangling = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: linked-specs\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(dangling, contractYaml());
    await symlink(join(dangling, "missing-specs"), join(dangling, "linked-specs"), "dir");

    await expect(buildUiVerificationPlan({ cwd: dangling })).rejects.toThrow("verify.specDir linked-specs is a dangling symlink");
  });
});

function contract(): UIContract {
  return {
    id: "UI-INVOICE-001",
    title: "Download invoice button",
    status: "active",
    page: "InvoiceDetails",
    element: { id: "download_invoice_button", role: "button", label: "Download" },
    trigger: { event: "click" },
    requires: ["RULE-BILLING-001"],
    expected: [
      { type: "element-visible" },
      { type: "element-enabled", target: "download_invoice_button" },
      { type: "text-visible", text: "Download" },
      { type: "url-contains", value: "/invoices/" },
    ],
    implementation: [],
    tests: [],
    scenarios: [],
  };
}

function contractYaml(): string {
  return "id: UI-INVOICE-001\ntitle: Download invoice button\nstatus: active\npage: InvoiceDetails\nelement:\n  id: download_invoice_button\n  role: button\n  label: Download\ntrigger:\n  event: click\nrequires:\n  - RULE-BILLING-001\nexpected:\n  - type: element-visible\n  - type: element-enabled\n    target: download_invoice_button\n  - type: text-visible\n    text: Download\n  - type: url-contains\n    value: /invoices/\n";
}

async function project(config: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "logicgraph-verify-"));
  await mkdir(join(cwd, ".logicgraph", "rules"), { recursive: true });
  await mkdir(join(cwd, ".logicgraph", "ui-contracts"), { recursive: true });
  await writeFile(join(cwd, ".logicgraph", "config.yaml"), config, "utf8");
  return cwd;
}

async function writeContract(cwd: string, content: string): Promise<void> {
  await writeFile(join(cwd, ".logicgraph", "ui-contracts", "UI-INVOICE-001.yaml"), content, "utf8");
}
