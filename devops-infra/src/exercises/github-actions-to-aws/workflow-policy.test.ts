import { describe, expect, it } from 'vitest';
import { asArray, asString, at, isRecord, readJson, readText, readYamlDocument } from '../../lib/documents';
import { deployWorkflowFindings, ENVIRONMENTS, environmentOf } from './workflow-policy';

const file = (name: string) => new URL(`./${name}`, import.meta.url);
const problem = readYamlDocument(file('workflows/deploy.problem.yml'));
const deploy = readYamlDocument(file('workflows/deploy.yml'));
const pr = readYamlDocument(file('workflows/pr.yml'));
const trustPolicy = readJson(file('iam/trust-policy.json'));
const deployPermissions = readJson(file('iam/deploy-permissions.json'));

function jobs(workflow: unknown): Record<string, unknown> {
  const value = at(workflow, 'jobs');
  return isRecord(value) ? value : {};
}

describe('deploy.problem.yml', () => {
  it('uses static keys, one job, the latest tag and no environments', () => {
    expect(deployWorkflowFindings(problem)).toEqual([
      "no top-level permissions: every job gets the repository's default token permissions",
      'static AWS access keys stored as secrets: long-lived, and valid outside GitHub too',
      'image tagged latest: nothing says which commit is running, and a rollback has no target',
      'one job builds, tests and deploys: no stage can be gated, approved or retried on its own',
      'no promotion dev → int → stag → prod through GitHub environments',
    ]);
  });
});

describe('deploy.yml', () => {
  it('follows every rule', () => {
    expect(deployWorkflowFindings(deploy)).toEqual([]);
  });

  it('builds once and deploys the same image digest to every environment', () => {
    expect(readText(file('workflows/deploy.yml'))).toContain('DIGEST: ${{ steps.push.outputs.digest }}');
    const deployJobs = Object.values(jobs(deploy)).filter((job) => environmentOf(job) !== undefined);
    expect(deployJobs.map((job) => environmentOf(job))).toEqual([...ENVIRONMENTS]);
    for (const job of deployJobs) {
      const rollout = asArray(at(job, 'steps')).find((step) => at(step, 'name') === 'Roll out the image');
      expect(at(rollout, 'env', 'IMAGE')).toBe('${{ needs.build.outputs.image }}');
    }
  });

  it('gives AWS access only to the jobs that need it, through OIDC', () => {
    expect(at(deploy, 'permissions')).toEqual({ contents: 'read' });
    const withToken = Object.entries(jobs(deploy)).filter(([, job]) => at(job, 'permissions', 'id-token') === 'write');
    expect(withToken.map(([id]) => id)).toEqual(['build', 'deploy-dev', 'deploy-int', 'deploy-stag', 'deploy-prod']);
  });
});

describe('pr.yml', () => {
  it('runs lint, test and build on pull requests with a read-only token and no secrets', () => {
    expect(at(pr, 'on')).toEqual({ pull_request: { branches: ['main'] } });
    expect(at(pr, 'permissions')).toEqual({ contents: 'read' });
    expect(Object.keys(jobs(pr))).toEqual(['lint', 'test', 'build']);
    expect(readText(file('workflows/pr.yml'))).not.toMatch(/secrets\.|id-token/);
  });

  it('cancels the run of an outdated push to the same pull request', () => {
    expect(at(pr, 'concurrency', 'cancel-in-progress')).toBe(true);
  });
});

describe('IAM', () => {
  const [statement] = asArray(at(trustPolicy, 'Statement'));

  it('trusts GitHub OIDC tokens for this repository and the prod environment only', () => {
    expect(at(statement, 'Action')).toBe('sts:AssumeRoleWithWebIdentity');
    expect(asString(at(statement, 'Principal', 'Federated'))).toMatch(
      /oidc-provider\/token\.actions\.githubusercontent\.com$/,
    );
    expect(at(statement, 'Condition')).toEqual({
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        'token.actions.githubusercontent.com:sub': 'repo:ORG/REPO:environment:prod',
      },
    });
  });

  it('lets the deploy role read one cluster and nothing else', () => {
    expect(at(deployPermissions, 'Statement')).toEqual([
      expect.objectContaining({
        Effect: 'Allow',
        Action: 'eks:DescribeCluster',
        Resource: expect.stringMatching(/:cluster\/katas-prod$/),
      }),
    ]);
  });
});
