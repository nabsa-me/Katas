import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

/**
 * Reads every document of a YAML file (a manifest file may hold several, separated by `---`).
 * A syntax error throws instead of producing a half-parsed value. YAML 1.2 rules apply, so a
 * workflow's `on:` key stays the string "on" instead of turning into `true` as in YAML 1.1.
 */
export function readYamlDocuments(file: URL): unknown[] {
  const documents = parseAllDocuments(readFileSync(file, 'utf8'));
  if ('empty' in documents) return [];
  return documents.map((document) => {
    const [error] = document.errors;
    if (error) throw new Error(`${fileURLToPath(file)}: ${error.message}`);
    return document.toJS();
  });
}

/** Reads a YAML file that must hold exactly one document. */
export function readYamlDocument(file: URL): unknown {
  const documents = readYamlDocuments(file);
  if (documents.length !== 1) {
    throw new Error(`${fileURLToPath(file)}: expected one YAML document, found ${documents.length}`);
  }
  return documents[0];
}

export function readJson(file: URL): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function readText(file: URL): string {
  return readFileSync(file, 'utf8');
}

/** Parsed files are external data: their values are read through these guards, never cast. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Follows a path of keys through nested objects; `undefined` as soon as a step is missing. */
export function at(value: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
