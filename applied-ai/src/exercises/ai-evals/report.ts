import type { EvalSummary } from './runner';

const percent = (value: number) => `${(value * 100).toFixed(1)} %`;
const ratio = ({ passed, total }: { passed: number; total: number }) =>
  `${passed}/${total}  ${total === 0 ? '-' : percent(passed / total)}`;
const ms = (value: number | undefined) => (value === undefined ? 'n/a' : `${Math.round(value)} ms`);

/** The plain-text report `npm run eval` prints: the gate's verdict first, then what explains it. */
export function formatReport(summary: EvalSummary): string {
  const { usage } = summary;
  const lines = [
    `Issue work type eval: ${summary.cases} cases, model ${summary.model}${summary.judge ? `, judge ${summary.judge}` : ''}`,
    `  ${summary.ok ? 'PASS' : 'FAIL'}  ${ratio({ passed: summary.passed, total: summary.cases })} passed every grader (minimum ${percent(summary.minPassRate)})`,
    ...Object.entries(summary.graders).map(([grader, counts]) => `  ${grader.padEnd(12)}${ratio(counts)}`),
    `  ${'edge cases'.padEnd(12)}${ratio(summary.edgeCases)}`,
    `  latency     p50 ${ms(summary.latencyMs.p50)}, p95 ${ms(summary.latencyMs.p95)}`,
    `  tokens      model ${usage.model.inputTokens} in / ${usage.model.outputTokens} out, judge ${usage.judge.inputTokens} in / ${usage.judge.outputTokens} out`,
    `  cost        ${summary.estimatedCostUsd === null ? 'unknown (no price for this model)' : `${summary.estimatedCostUsd.toFixed(4)} USD, estimated`}`,
  ];
  if (summary.failures.length > 0) {
    lines.push('Failures:');
    for (const failure of summary.failures) {
      const reasons = failure.grades.filter((grade) => !grade.pass).map((grade) => `${grade.grader}: ${grade.detail}`);
      lines.push(
        `  ${failure.id}${failure.edgeCase ? ` [${failure.edgeCase}]` : ''}`,
        ...reasons.map((r) => `    ${r}`),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
