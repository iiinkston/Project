/** Production default is agent:start — never printer:test. */
export function resolveCommand(argv: string[]): string {
  return argv[2] ?? "agent:start";
}

export type DoctorFlags = {
  /** Focused TCP printer check (`doctor --printer`). */
  printerOnly: boolean;
};

export function resolveDoctorFlags(argv: string[]): DoctorFlags {
  return {
    printerOnly: argv.includes("--printer"),
  };
}

/** `agent:start --dry-run` — validate startup artifacts then exit (pkg smoke). */
export function resolveAgentStartDryRun(argv: string[]): boolean {
  const command = resolveCommand(argv);
  if (command !== "agent:start") {
    return false;
  }
  return argv.includes("--dry-run") || argv.includes("--dryRun");
}
