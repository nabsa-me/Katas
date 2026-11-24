import { describe, expect, it } from 'vitest';
import { evaluate, type DockerCheck } from './validator';

const run = { image: 'hadolint/hadolint:v2.15.1', workdir: '', args: ['hadolint', 'Dockerfile'] };
const mustPass: DockerCheck = { title: 'solution', run };
const mustFail: DockerCheck = { title: 'problem', run, expectedFindings: ['DL3007', 'DL3059'] };

describe('evaluate', () => {
  it('passes a clean file only with exit code 0', () => {
    expect(evaluate(mustPass, { exitCode: 0, output: '' }).passed).toBe(true);
    expect(evaluate(mustPass, { exitCode: 1, output: 'Dockerfile:1 DL3007' })).toEqual({
      passed: false,
      reason: 'expected no findings, the tool exited with 1',
    });
  });

  it('passes a flawed file when the tool exits with 1 and reports every expected rule', () => {
    expect(evaluate(mustFail, { exitCode: 1, output: 'Dockerfile:1 DL3007 …\nDockerfile:5 DL3059 …' }).passed).toBe(
      true,
    );
  });

  it('fails a flawed file when an expected rule is missing, as when the path is wrong', () => {
    expect(evaluate(mustFail, { exitCode: 1, output: 'openFile: does not exist' })).toEqual({
      passed: false,
      reason: 'missing expected findings: DL3007, DL3059',
    });
  });

  it('fails a flawed file when the tool itself could not run', () => {
    expect(evaluate(mustFail, { exitCode: 125, output: 'DL3007 DL3059' }).passed).toBe(false);
  });
});
