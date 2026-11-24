import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { addUsage, estimateCostUsd, NO_USAGE, type CallUsage } from '../claude-bedrock/usage';
import { classificationSchema, classifyIssue, type ModelReply, type TextModel } from './classifier';
import type { GoldenCase } from './dataset';
import { exactMatch, jsonSchema, llmJudge, regexMatch, type Grade, type JudgeModel } from './graders';
import { percentile } from './percentile';

const evalConfigSchema = z.strictObject({
  /** The CI gate: the run fails when fewer cases than this pass every grader. */
  minPassRate: z.number().min(0).max(1),
  /** Whether to run the LLM judge on each rationale. It doubles the model calls of a real run. */
  judge: z.boolean(),
});

export type EvalConfig = z.infer<typeof evalConfigSchema>;

export function loadEvalConfig(file = new URL('./eval.config.json', import.meta.url)): EvalConfig {
  return evalConfigSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export interface CaseResult {
  id: string;
  edgeCase: string | undefined;
  expected: string;
  actual: string | undefined;
  grades: Grade[];
  passed: boolean;
  latencyMs: number | undefined;
}

export interface EvalSummary {
  model: string;
  judge: string | undefined;
  cases: number;
  passed: number;
  passRate: number;
  minPassRate: number;
  ok: boolean;
  /** Passes per grader, so a drop can be traced to labels, format or reasoning. */
  graders: Record<string, { passed: number; total: number }>;
  edgeCases: { passed: number; total: number };
  latencyMs: { p50: number | undefined; p95: number | undefined };
  usage: { model: CallUsage; judge: CallUsage };
  estimatedCostUsd: number | null;
  failures: CaseResult[];
}

const usageOf = (reply: ModelReply | undefined): CallUsage =>
  reply ? { ...NO_USAGE, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens } : NO_USAGE;

export interface RunEvalOptions {
  cases: readonly GoldenCase[];
  model: TextModel;
  judge?: JudgeModel;
  config: EvalConfig;
}

/**
 * Runs every golden case through the feature and grades it: label (exact or regex), JSON schema and, when enabled,
 * the LLM judge. A case passes only if every grader passes; a model error fails the case, never the whole run.
 * Cases run one after another, which keeps a real run under the account's rate limits.
 */
export async function runEval({ cases, model, judge, config }: RunEvalOptions) {
  const results: CaseResult[] = [];
  let modelUsage = NO_USAGE;
  let judgeUsage = NO_USAGE;

  for (const testCase of cases) {
    const base = { id: testCase.id, edgeCase: testCase.edgeCase, expected: testCase.expected };
    let reply: ModelReply;
    try {
      reply = await classifyIssue(testCase, model);
    } catch (error) {
      const detail = `model error: ${error instanceof Error ? error.message : String(error)}`;
      const grades = [{ grader: 'model call', pass: false, detail }];
      results.push({ ...base, actual: undefined, grades, passed: false, latencyMs: undefined });
      continue;
    }
    modelUsage = addUsage(modelUsage, usageOf(reply));

    const { grade: schemaGrade, value } = jsonSchema(classificationSchema, reply.text);
    const actual = value?.workType;
    const labelGrade = testCase.accept ? regexMatch(testCase.accept, actual) : exactMatch(testCase.expected, actual);
    const grades: Grade[] = [labelGrade, schemaGrade];
    if (config.judge && judge && value) {
      const verdict = await llmJudge(judge, testCase, value).catch((error: unknown) => ({
        grader: 'judge',
        pass: false,
        detail: `judge error: ${error instanceof Error ? error.message : String(error)}`,
        reply: undefined,
      }));
      judgeUsage = addUsage(judgeUsage, usageOf(verdict.reply));
      grades.push({
        grader: verdict.grader,
        pass: verdict.pass,
        ...(verdict.detail ? { detail: verdict.detail } : {}),
      });
    }
    results.push({ ...base, actual, grades, passed: grades.every((g) => g.pass), latencyMs: reply.latencyMs });
  }

  return { results, summary: summarize(results, { model, judge, config, modelUsage, judgeUsage }) };
}

function summarize(
  results: CaseResult[],
  run: { model: TextModel; judge?: JudgeModel; config: EvalConfig; modelUsage: CallUsage; judgeUsage: CallUsage },
): EvalSummary {
  const passed = results.filter((result) => result.passed).length;
  const passRate = results.length === 0 ? 0 : passed / results.length;
  const graders: EvalSummary['graders'] = {};
  for (const grade of results.flatMap((result) => result.grades)) {
    const entry = (graders[grade.grader] ??= { passed: 0, total: 0 });
    entry.total += 1;
    if (grade.pass) entry.passed += 1;
  }
  const edge = results.filter((result) => result.edgeCase !== undefined);
  const latencies = results.flatMap((result) => (result.latencyMs === undefined ? [] : [result.latencyMs]));
  const modelCost = estimateCostUsd(run.model.pricingId, run.modelUsage);
  const judgeCost = run.judge ? estimateCostUsd(run.judge.pricingId, run.judgeUsage) : 0;
  return {
    model: run.model.id,
    judge: run.config.judge ? run.judge?.id : undefined,
    cases: results.length,
    passed,
    passRate,
    minPassRate: run.config.minPassRate,
    ok: passRate >= run.config.minPassRate,
    graders,
    edgeCases: { passed: edge.filter((result) => result.passed).length, total: edge.length },
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    usage: { model: run.modelUsage, judge: run.judgeUsage },
    estimatedCostUsd: modelCost === null || judgeCost === null ? null : Math.round((modelCost + judgeCost) * 1e6) / 1e6,
    failures: results.filter((result) => !result.passed),
  };
}
