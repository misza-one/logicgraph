import { validateRules, type RuleValidationResult } from "@logicgraph/core";

export async function validateRulesCommand(): Promise<void> {
  try {
    const result = await validateRules();
    console.log(formatRuleValidation(result));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function formatRuleValidation(result: RuleValidationResult): string {
  const lines = ["Validating LogicGraph rules...", ""];

  for (const file of result.files) {
    if (file.valid) {
      lines.push(`✓ ${file.id}`);
      continue;
    }

    lines.push(`✗ ${file.relativePath}`, "");
    for (const error of file.errors) {
      lines.push(`${error.path}:`, error.message, "");
    }
  }

  for (const duplicate of result.duplicateIds) {
    lines.push(`✗ duplicate rule ID ${duplicate.id}`);
    lines.push(...duplicate.files.map((file) => `  ${file}`), "");
  }

  lines.push(`${result.validRuleCount} ${result.validRuleCount === 1 ? "rule" : "rules"} valid.`);
  return lines.join("\n").trimEnd();
}
