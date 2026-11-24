import { describe, expect, it } from 'vitest';
import { loadGoldenCases, parseGoldenJsonl, slugify, WORK_TYPES } from './dataset';

describe('golden.jsonl', () => {
  const cases = loadGoldenCases();

  it('has about twenty cases, every work type well represented', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    for (const workType of WORK_TYPES) {
      expect(cases.filter((testCase) => testCase.expected === workType).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('includes edge cases, each saying why it is hard', () => {
    const edgeCases = cases.filter((testCase) => testCase.edgeCase);
    expect(edgeCases.length).toBeGreaterThanOrEqual(6);
    expect(edgeCases.map((testCase) => testCase.edgeCase)).toEqual(
      expect.arrayContaining(['prompt injection in the description', 'not in English', 'no description']),
    );
  });

  it('accepts more than one label only where the pattern includes the expected one', () => {
    for (const testCase of cases.filter((c) => c.accept)) {
      expect(new RegExp(testCase.accept!).test(testCase.expected)).toBe(true);
    }
  });
});

describe('parseGoldenJsonl', () => {
  it('generates the id from the summary and skips blank lines', () => {
    const cases = parseGoldenJsonl('\n{"summary": "Café menu crashes", "description": "", "expected": "bug"}\n\n');
    expect(cases).toEqual([
      { id: 'cafe-menu-crashes', summary: 'Café menu crashes', description: '', expected: 'bug' },
    ]);
  });

  it('reports every invalid line with its number', () => {
    const text = [
      '{"summary": "A", "description": "", "expected": "bug"}',
      'not json',
      '{"summary": "B", "description": "", "expected": "improvement"}',
      '{"summary": "C", "description": "", "expected": "bug", "accept": "("}',
      '{"summary": "a", "description": "", "expected": "chore"}',
    ].join('\n');
    expect(() => parseGoldenJsonl(text)).toThrow(
      /line 2: not valid JSON[\s\S]*line 3: .*expected[\s\S]*line 4: .*valid regular expression[\s\S]*line 5: duplicate id "a" \(first on line 1\)/,
    );
  });
});

describe('slugify', () => {
  it('lowercases, drops accents and joins words with dashes', () => {
    expect(slugify('El botón de guardar no funciona en Safari')).toBe('el-boton-de-guardar-no-funciona-en-safari');
    expect(slugify('Admin endpoint /api/admin/users answers without a login')).toBe(
      'admin-endpoint-api-admin-users-answers-without-a-login',
    );
  });
});
