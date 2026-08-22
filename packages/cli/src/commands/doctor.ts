import { runDoctor, type DoctorResult, type DoctorSection, type DoctorStatus } from "@logicgraph/core";

const sections: DoctorSection[] = ["Project", "Rules", "References"];
const marks: Record<DoctorStatus, string> = {
  ok: "✓",
  warning: "⚠",
  error: "✗",
};

export async function doctorCommand(): Promise<void> {
  try {
    const result = await runDoctor();
    console.log(formatDoctor(result));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function formatDoctor(result: DoctorResult): string {
  const lines = ["LogicGraph doctor"];

  for (const section of sections) {
    lines.push("", section);
    for (const check of result.checks.filter((item) => item.section === section)) {
      lines.push(`${marks[check.status]} ${check.message}`);
      if (check.details) {
        lines.push(...check.details.map((detail) => `  ${detail}`));
      }
    }
  }

  lines.push("", "Result");
  if (result.ok) {
    lines.push(
      result.warningCount > 0
        ? `✓ LogicGraph has 0 errors and ${result.warningCount} ${plural(result.warningCount, "warning")}`
        : "✓ LogicGraph has 0 errors",
    );
  } else {
    lines.push(`✗ LogicGraph has ${result.errorCount} ${plural(result.errorCount, "error")}`);
  }

  return lines.join("\n");
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
