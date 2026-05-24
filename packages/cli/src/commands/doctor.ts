import { resolveBundle } from "../lib/bundle.js";

interface DoctorCheck {
  id: string;
  label: string;
  severity: "ok" | "warn" | "error";
  detail: string;
  hint?: string;
}
interface DoctorReport {
  checks: DoctorCheck[];
  worstSeverity: "ok" | "warn" | "error";
}

const COLORS = {
  ok: "\x1b[32m✓\x1b[0m",
  warn: "\x1b[33m!\x1b[0m",
  error: "\x1b[31m✗\x1b[0m",
};

export async function runDoctor(): Promise<void> {
  const bundle = resolveBundle();
  const doctorModulePath = bundle.serverEntry.replace(/main\.js$/, "doctor.js");
  let report: DoctorReport;
  try {
    const mod = (await import(doctorModulePath)) as {
      runDoctor: () => Promise<DoctorReport>;
    };
    report = await mod.runDoctor();
  } catch (e) {
    process.stderr.write(
      `[copilot-deck] doctor module unavailable: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(2);
  }

  const labelWidth = Math.max(...report.checks.map((c) => c.label.length));
  for (const c of report.checks) {
    const sym = COLORS[c.severity];
    process.stdout.write(`${sym}  ${c.label.padEnd(labelWidth)}  ${c.detail}\n`);
    if (c.hint) process.stdout.write(`     ↳ ${c.hint}\n`);
  }
  process.stdout.write("\n");
  if (report.worstSeverity === "error") process.exit(2);
  if (report.worstSeverity === "warn") process.exit(1);
  process.exit(0);
}
