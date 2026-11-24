import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { asArray, asString, at, isRecord, readYamlDocument, readYamlDocuments } from './documents';

const dir = mkdtempSync(path.join(tmpdir(), 'devops-infra-documents-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function yamlFile(name: string, content: string): URL {
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return pathToFileURL(file);
}

describe('readYamlDocuments', () => {
  it('reads every document separated by ---', () => {
    const file = yamlFile('two.yaml', 'kind: Service\n---\nkind: Deployment\n');
    expect(readYamlDocuments(file)).toEqual([{ kind: 'Service' }, { kind: 'Deployment' }]);
  });

  it('keeps a workflow `on:` key as a string (YAML 1.2), not as the boolean true', () => {
    const file = yamlFile('workflow.yml', 'on:\n  push:\n    branches: [main]\n');
    expect(readYamlDocument(file)).toEqual({ on: { push: { branches: ['main'] } } });
  });

  it('throws on a syntax error instead of returning a partial value', () => {
    const file = yamlFile('broken.yaml', 'spec:\n  - a\n b: c\n');
    expect(() => readYamlDocuments(file)).toThrow(/broken\.yaml/);
  });

  it('requires exactly one document when asked for one', () => {
    const file = yamlFile('many.yaml', 'a: 1\n---\nb: 2\n');
    expect(() => readYamlDocument(file)).toThrow(/expected one YAML document, found 2/);
  });
});

describe('guards', () => {
  const manifest = { spec: { template: { spec: { containers: [{ name: 'web' }] } } } };

  it('follows a path of keys and stops at the first missing step', () => {
    expect(asArray(at(manifest, 'spec', 'template', 'spec', 'containers'))).toHaveLength(1);
    expect(at(manifest, 'spec', 'missing', 'containers')).toBeUndefined();
    expect(at('not an object', 'spec')).toBeUndefined();
  });

  it('accepts only what it says', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(asArray('web')).toEqual([]);
    expect(asString(42)).toBeUndefined();
  });
});
