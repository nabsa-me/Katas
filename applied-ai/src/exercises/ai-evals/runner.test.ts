import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID } from '../claude-bedrock/bedrock-client';
import type { TextModel } from './classifier';
import { loadGoldenCases, parseGoldenJsonl } from './dataset';
import { spotCheck } from './eval.problem';
import { mockClassifier, mockJudge } from './mock-models';
import { formatReport } from './report';
import { loadEvalConfig, runEval } from './runner';

const cases = loadGoldenCases();
const config = loadEvalConfig();

/** A model that answers every issue the same way: what a broken prompt or a model swap can look like. */
function alwaysAnswers(text: string, latencyMs = 400): TextModel {
  return {
    id: 'always-the-same',
    pricingId: DEFAULT_MODEL_ID,
    complete: async () => ({ text, inputTokens: 200, outputTokens: 30, latencyMs }),
  };
}

describe('runEval with the deterministic mock (what CI runs)', () => {
  it('passes the gate and explains every failure', async () => {
    const { summary } = await runEval({ cases, model: mockClassifier, judge: mockJudge, config });

    expect(summary).toMatchObject({ cases: 20, passed: 18, passRate: 0.9, minPassRate: 0.85, ok: true });
    expect(summary.graders).toEqual({
      label: { passed: 19, total: 20 },
      'json schema': { passed: 20, total: 20 },
      judge: { passed: 18, total: 20 },
    });
    expect(summary.edgeCases).toEqual({ passed: 6, total: 8 });
    expect(summary.failures.map((failure) => failure.id)).toEqual([
      'el-boton-de-guardar-no-funciona-en-safari',
      'dark-mode',
    ]);
  });

  it('measures latency percentiles, tokens and an estimated cost', async () => {
    const { summary } = await runEval({ cases, model: mockClassifier, judge: mockJudge, config });
    expect(summary.latencyMs.p50).toBeLessThanOrEqual(summary.latencyMs.p95!);
    expect(summary.usage.model.inputTokens).toBeGreaterThan(0);
    expect(summary.usage.judge.outputTokens).toBeGreaterThan(0);
    expect(summary.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('prints the verdict first, then the graders and the failures', async () => {
    const { summary } = await runEval({ cases, model: mockClassifier, judge: mockJudge, config });
    const report = formatReport(summary);
    expect(report.split('\n').slice(0, 3)).toEqual([
      'Issue work type eval: 20 cases, model mock-keyword-classifier, judge mock-rubric-judge',
      '  PASS  18/20  90.0 % passed every grader (minimum 85.0 %)',
      '  label       19/20  95.0 %',
    ]);
    expect(report).toContain(
      '  el-boton-de-guardar-no-funciona-en-safari [not in English]\n    label: expected bug, got feature',
    );
  });
});

describe('the CI gate', () => {
  it('fails when quality drops below the threshold', async () => {
    const regressed = alwaysAnswers('{"workType":"bug","rationale":"The issue says something is broken."}');
    const { summary } = await runEval({ cases, model: regressed, judge: mockJudge, config });
    expect(summary.ok).toBe(false);
    expect(summary.passRate).toBeLessThan(config.minPassRate);
    expect(formatReport(summary)).toMatch(/^.*\n {2}FAIL /);
  });

  it('counts replies that are not the expected JSON as failures', async () => {
    const chatty = alwaysAnswers('Sure! This looks like a bug to me.');
    const { summary } = await runEval({ cases, model: chatty, judge: mockJudge, config });
    expect(summary.graders['json schema']).toEqual({ passed: 0, total: 20 });
    expect(summary.graders.judge).toBeUndefined(); // nothing to judge without a parsed rationale
  });

  it('records a model error as a failed case and keeps going', async () => {
    let calls = 0;
    const flaky: TextModel = {
      ...mockClassifier,
      complete: async (system, user) => {
        calls += 1;
        if (calls === 1) throw new Error('ThrottlingException');
        return mockClassifier.complete(system, user);
      },
    };
    const { results } = await runEval({ cases, model: flaky, judge: mockJudge, config });
    expect(results[0]?.grades).toEqual([
      { grader: 'model call', pass: false, detail: 'model error: ThrottlingException' },
    ]);
    expect(results).toHaveLength(20);
  });

  it('skips the judge when the configuration turns it off', async () => {
    const { summary } = await runEval({
      cases,
      model: mockClassifier,
      judge: mockJudge,
      config: { ...config, judge: false },
    });
    expect(summary).toMatchObject({ judge: undefined, passed: 19 });
    expect(summary.usage.judge.inputTokens).toBe(0);
  });

  it('accepts any label the case allows', async () => {
    const [emails] = parseGoldenJsonl(
      '{"summary": "Emails delayed since the deploy", "description": "", "expected": "incident", "accept": "^(incident|bug)$"}',
    );
    const asBug = alwaysAnswers('{"workType":"bug","rationale":"The issue says \\"delayed\\" after a deploy."}');
    const { summary } = await runEval({ cases: [emails!], model: asBug, judge: mockJudge, config });
    expect(summary.passed).toBe(1);
  });
});

describe('flawed spot check', () => {
  it('reports success for a model that answers "bug" to everything', async () => {
    const regressed = alwaysAnswers('{"workType":"bug","rationale":"The issue says something is broken."}');
    const printed: string[] = [];
    expect(await spotCheck(regressed, (line) => printed.push(line))).toBe(0);
    expect(printed).toHaveLength(3);
    const { summary } = await runEval({ cases, model: regressed, judge: mockJudge, config });
    expect(summary.ok).toBe(false);
  });
});
