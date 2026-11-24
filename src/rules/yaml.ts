import fs from 'node:fs';
import { load as yamlLoad } from 'js-yaml'; // js-yaml 5 has no default export
import type { ZodError } from 'zod';
import { SheetError } from '../errors.js';

/** Read and parse a YAML file. Throws SheetError (with the path) on read or parse failure. */
export function loadYamlFile(filePath: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new SheetError(`Cannot read "${filePath}": ${(e as Error).message}`);
  }
  try {
    return yamlLoad(text);
  } catch (e) {
    throw new SheetError(`Invalid YAML in "${filePath}": ${(e as Error).message}`);
  }
}

/** Format a zod error as one line per issue: `file: path.to[0].field: message`. */
export function formatZodError(filePath: string, err: ZodError): string {
  return err.issues
    .map((i) => {
      const p = i.path.reduce<string>(
        (acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)),
        '',
      );
      return `${filePath}: ${p || '(root)'}: ${i.message}`;
    })
    .join('\n');
}
