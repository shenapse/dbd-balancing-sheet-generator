/** A rule violation found in a build (shape is owned by the builds command). */
export interface Violation {
  /** Rule kind, e.g. `combo-ban`, `pick-limit`. */
  rule: string;
  /** Human-readable explanation. */
  message: string;
  /** Optional extra fields (scope, build row, ...). */
  [key: string]: unknown;
}

/** Per-input-file section of the `--json` summary. */
export interface FileReport {
  /** Input file path as given on the command line. */
  input: string;
  /** Files written for this input (PNG paths). */
  outputs: string[];
  /** Warnings attributed to this input. */
  warnings: string[];
  /** Present for builds when rules were checked. */
  violations?: Violation[];
}

/** Top-level `--json` summary written to stdout. */
export interface Report {
  tool: string;
  version: string;
  /** dbd-assets commit SHA, or null if unknown. */
  assetsRef: string | null;
  /** Subcommand name, e.g. `perks`. */
  command: string;
  files: FileReport[];
  /** Warnings not tied to a single input file. */
  warnings: string[];
}

/**
 * Collects results of a command run. Human-readable text goes to stderr via
 * {@link Reporter.log} so stdout stays clean for the JSON summary.
 */
export class Reporter {
  readonly files: FileReport[] = [];
  readonly warnings: string[] = [];

  constructor(
    readonly meta: { tool: string; version: string; assetsRef: string | null; command: string },
    private readonly quiet = false,
  ) {}

  /** Human log line to stderr (suppressed when `quiet`). */
  log(message: string): void {
    if (!this.quiet) process.stderr.write(message + '\n');
  }

  /**
   * Start (or get) the section for an input file. Use the returned object to
   * push outputs, warnings and violations.
   */
  file(input: string): FileReport {
    let f = this.files.find((x) => x.input === input);
    if (!f) {
      f = { input, outputs: [], warnings: [] };
      this.files.push(f);
    }
    return f;
  }

  /** Record a warning (also logged). Attach to `input` if given, else global. */
  warn(message: string, input?: string): void {
    if (input !== undefined) this.file(input).warnings.push(message);
    else this.warnings.push(message);
    this.log(`warning: ${message}`);
  }

  /** Record a written output file for `input` (also logged). */
  output(input: string, outputPath: string): void {
    this.file(input).outputs.push(outputPath);
    this.log(`wrote ${outputPath}`);
  }

  /** Record violations for `input`. */
  violations(input: string, violations: Violation[]): void {
    const f = this.file(input);
    f.violations = [...(f.violations ?? []), ...violations];
  }

  /** True if any violation was recorded (drives `--strict` exit code 1). */
  get hasViolations(): boolean {
    return this.files.some((f) => (f.violations?.length ?? 0) > 0);
  }

  toJSON(): Report {
    return { ...this.meta, files: this.files, warnings: this.warnings };
  }

  /** Print the JSON summary to stdout. */
  emitJson(): void {
    process.stdout.write(JSON.stringify(this.toJSON(), null, 2) + '\n');
  }
}
