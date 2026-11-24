import { describe, expect, it } from 'vitest';
import { asArray, at, isRecord, readJson, readText, readYamlDocument } from '../../lib/documents';
import { matchesPattern, ownersFor, parseCodeowners } from './code-owners';

const file = (name: string) => new URL(name, import.meta.url);
const ruleset = readJson(file('./ruleset-main.json'));
const codeowners = parseCodeowners(readText(file('./CODEOWNERS')));
const template = readText(file('./pull_request_template.md'));
const prWorkflow = readYamlDocument(file('../github-actions-to-aws/workflows/pr.yml'));

const rule = (type: string) => asArray(at(ruleset, 'rules')).find((r) => at(r, 'type') === type);

describe('ruleset for main', () => {
  it('applies to the default branch, is enforced and has no bypass', () => {
    expect(at(ruleset, 'target')).toBe('branch');
    expect(at(ruleset, 'enforcement')).toBe('active');
    expect(at(ruleset, 'conditions', 'ref_name', 'include')).toEqual(['~DEFAULT_BRANCH']);
    expect(at(ruleset, 'bypass_actors')).toEqual([]);
  });

  it('blocks deleting the branch and force pushes', () => {
    expect(rule('deletion')).toBeDefined();
    expect(rule('non_fast_forward')).toBeDefined();
  });

  it('requires a pull request approved by a code owner, again after new pushes', () => {
    expect(at(rule('pull_request'), 'parameters')).toMatchObject({
      required_approving_review_count: 1,
      require_code_owner_review: true,
      dismiss_stale_reviews_on_push: true,
      require_last_push_approval: true,
      required_review_thread_resolution: true,
    });
  });

  it('requires exactly the jobs of pr.yml, reported by GitHub Actions, on an up-to-date branch', () => {
    const parameters = at(rule('required_status_checks'), 'parameters');
    const checks = asArray(at(parameters, 'required_status_checks'));
    const jobs = at(prWorkflow, 'jobs');
    expect(checks.map((check) => at(check, 'context'))).toEqual(isRecord(jobs) ? Object.keys(jobs) : []);
    expect(checks.every((check) => at(check, 'integration_id') === 15368)).toBe(true);
    expect(at(parameters, 'strict_required_status_checks_policy')).toBe(true);
  });
});

describe('CODEOWNERS', () => {
  it.each([
    ['migrations/20261124_add_display_name.sql', ['@ORG/database-owners']],
    ['infra/terraform/main.tf', ['@ORG/platform-team']],
    ['permissions/app-roles.json', ['@ORG/security-team']],
    ['.github/workflows/deploy.yml', ['@ORG/platform-team']],
    ['.github/CODEOWNERS', ['@ORG/platform-team', '@ORG/security-team']],
    ['src/app/page.tsx', ['@ORG/web-team']],
  ])('%s is owned by %j', (path, owners) => {
    expect(ownersFor(path, codeowners)).toEqual(owners);
  });

  it('anchors /migrations/ at the root: a nested folder with the same name falls back to the default', () => {
    expect(ownersFor('src/migrations/README.md', codeowners)).toEqual(['@ORG/web-team']);
  });

  it('uses the last matching rule, so a catch-all written last would override everything', () => {
    const reversed = parseCodeowners('/migrations/ @ORG/database-owners\n* @ORG/web-team\n');
    expect(ownersFor('migrations/0001.sql', reversed)).toEqual(['@ORG/web-team']);
  });

  it('follows GitHub pattern rules for wildcards and unanchored names', () => {
    expect(matchesPattern('*.sql', 'db/seeds/teams.sql')).toBe(true);
    expect(matchesPattern('docs/*', 'docs/runbook.md')).toBe(true);
    expect(matchesPattern('docs/*', 'docs/guides/runbook.md')).toBe(false);
    expect(matchesPattern('apps/', 'services/apps/web.ts')).toBe(true);
    expect(matchesPattern('/apps/', 'services/apps/web.ts')).toBe(false);
    expect(matchesPattern('/infra/**/*.tf', 'infra/envs/prod/main.tf')).toBe(true);
  });
});

describe('pull request template', () => {
  it('asks about schema, permissions and infrastructure changes, and for a rollback plan', () => {
    for (const topic of ['Database schema or migrations', 'Permissions', 'Infrastructure', '## Rollback plan']) {
      expect(template).toContain(topic);
    }
  });
});
