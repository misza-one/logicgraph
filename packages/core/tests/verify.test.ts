import { mkdir, symlink, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildUiVerificationPlan,
  generateUiVerificationSpec,
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

  it("generates deterministic specs for known browser-observable assertions", () => {
    const spec = generateUiVerificationSpec(contract(), "/invoices/fixture-paid");

    expect(spec).toContain("// logicgraph-ui-contract: UI-INVOICE-001");
    expect(spec).toContain("process.env.LOGICGRAPH_BASE_URL");
    expect(spec).toContain("await page.goto(new URL(route, baseUrl).toString());");
    expect(spec).toContain('const subject = page.getByRole("button" as never, { name: "Download" }).first();');
    expect(spec).toContain("await subject.click();");
    expect(spec).toContain('await expect(page.getByText("Download")).toBeVisible();');
    expect(spec).toContain('await expect(page).toHaveURL(new RegExp("/invoices/"));');
    expect(spec).not.toContain("not machine-verifiable");
  });

  it("marks unknown expected types as partial and comments them in the spec", () => {
    const ui = { ...contract(), expected: [{ type: "profile-saved" }] };

    expect(unknownVerificationReasons(ui)).toEqual(['unknown expected type "profile-saved"']);
    expect(generateUiVerificationSpec(ui, "/profile")).toContain('not machine-verifiable: unknown expected type "profile-saved"');
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
  });

  it("rejects specDir symlinks that resolve outside the repository", async () => {
    const cwd = await project("version: 1\nrules: rules\nuiContracts: ui-contracts\njourneys: journeys\nverify:\n  specDir: linked-specs\n  pages:\n    InvoiceDetails: /invoices/fixture-paid\n");
    await writeContract(cwd, contractYaml());
    const outside = await mkdtemp(join(tmpdir(), "logicgraph-outside-"));
    await symlink(outside, join(cwd, "linked-specs"), "dir");

    await expect(buildUiVerificationPlan({ cwd })).rejects.toThrow("verify.specDir linked-specs resolves outside repository");
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
