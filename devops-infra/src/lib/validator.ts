import type { DockerResult, DockerRun } from './run-in-docker';

export interface DockerCheck {
  /** What the check proves, printed before it runs. */
  title: string;
  run: Omit<DockerRun, 'hostDir'>;
  /**
   * Rule ids the tool must report. Absent: the files must pass (exit code 0). Present: exit code 1 with
   * every id in the output, which is how a `.problem` file proves its flaws. The exit code alone would
   * prove nothing: a mistyped path also exits with 1.
   */
  expectedFindings?: readonly string[];
}

/** One `npm run validate:<name>` target: the validator checks of one exercise. */
export interface Validator {
  name: string;
  checks: readonly DockerCheck[];
}

export interface Outcome {
  passed: boolean;
  reason: string;
}

/** Decides whether a validator run proved what the check expects. */
export function evaluate(check: DockerCheck, { exitCode, output }: DockerResult): Outcome {
  const expected = check.expectedFindings ?? [];
  if (expected.length === 0) {
    return exitCode === 0
      ? { passed: true, reason: 'no findings' }
      : { passed: false, reason: `expected no findings, the tool exited with ${exitCode}` };
  }
  const missing = expected.filter((finding) => !output.includes(finding));
  if (exitCode !== 1) {
    return { passed: false, reason: `expected findings (exit code 1), the tool exited with ${exitCode}` };
  }
  return missing.length === 0
    ? { passed: true, reason: `reported the expected findings: ${expected.join(', ')}` }
    : { passed: false, reason: `missing expected findings: ${missing.join(', ')}` };
}
