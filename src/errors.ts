/**
 * Authoring / usage error (bad YAML, unknown perk name, bad flag, missing assets...).
 * The CLI prints `message` to stderr and exits with code 2. Anything that is NOT a
 * SheetError is a bug (exit 3).
 */
export class SheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetError';
  }
}
