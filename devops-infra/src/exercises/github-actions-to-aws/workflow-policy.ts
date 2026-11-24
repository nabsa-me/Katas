import { asArray, asString, at, isRecord } from '../../lib/documents';

/** The promotion order, one GitHub environment per stage. */
export const ENVIRONMENTS = ['dev', 'int', 'stag', 'prod'] as const;

interface Job {
  id: string;
  value: unknown;
}

function jobsOf(workflow: unknown): Job[] {
  const jobs = at(workflow, 'jobs');
  return isRecord(jobs) ? Object.entries(jobs).map(([id, value]) => ({ id, value })) : [];
}

/** `environment: prod` and `environment: { name: prod, url: … }` are both valid. */
export function environmentOf(job: unknown): string | undefined {
  const environment = at(job, 'environment');
  return asString(environment) ?? asString(at(environment, 'name'));
}

function needsOf(job: unknown): unknown[] {
  const needs = at(job, 'needs');
  return Array.isArray(needs) ? needs : [needs];
}

const usesAction = (step: unknown, action: string) => asString(at(step, 'uses'))?.startsWith(`${action}@`) ?? false;

/**
 * Rules for a deployment workflow to AWS that actionlint cannot know: actionlint checks that a
 * workflow is valid, not that it is safe. Each finding says what is wrong and what it costs.
 */
export function deployWorkflowFindings(workflow: unknown): string[] {
  const jobs = jobsOf(workflow);
  const steps = jobs.flatMap((job) => asArray(at(job.value, 'steps')).map((step) => ({ job, step })));
  const credentials = steps.filter(({ step }) => usesAction(step, 'aws-actions/configure-aws-credentials'));
  const findings: string[] = [];

  if (at(workflow, 'permissions') === undefined) {
    findings.push("no top-level permissions: every job gets the repository's default token permissions");
  }
  if (credentials.some(({ step }) => at(step, 'with', 'aws-access-key-id') !== undefined)) {
    findings.push('static AWS access keys stored as secrets: long-lived, and valid outside GitHub too');
  }
  for (const { job } of credentials.filter(({ step }) => at(step, 'with', 'role-to-assume') !== undefined)) {
    const idToken = at(job.value, 'permissions', 'id-token') ?? at(workflow, 'permissions', 'id-token');
    if (idToken !== 'write') findings.push(`${job.id}: assumes a role without id-token: write`);
  }
  for (const { step } of steps) {
    const uses = asString(at(step, 'uses'));
    if (uses !== undefined && !/@(v\d+(\.\d+)*|[0-9a-f]{40})$/.test(uses)) {
      findings.push(`${uses}: not pinned to a release or a commit SHA`);
    }
  }
  if (/:latest\b/.test(JSON.stringify(workflow))) {
    findings.push('image tagged latest: nothing says which commit is running, and a rollback has no target');
  }
  if (jobs.length === 1) {
    findings.push('one job builds, tests and deploys: no stage can be gated, approved or retried on its own');
  }

  const deployJobs = jobs.filter((job) => environmentOf(job.value) !== undefined);
  const inOrder =
    deployJobs.map((job) => environmentOf(job.value)).join() === ENVIRONMENTS.join() &&
    deployJobs.every((job, i) => i === 0 || needsOf(job.value).includes(deployJobs[i - 1]?.id));
  if (!inOrder) findings.push('no promotion dev → int → stag → prod through GitHub environments');
  for (const job of deployJobs) {
    if (at(job.value, 'concurrency', 'group') === undefined || at(job.value, 'concurrency', 'cancel-in-progress')) {
      findings.push(`${job.id}: no concurrency group that queues deployments to the same environment`);
    }
  }
  return findings;
}
