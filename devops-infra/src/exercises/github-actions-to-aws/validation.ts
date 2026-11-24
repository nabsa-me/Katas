import type { Validator } from '../../lib/validator';

const ACTIONLINT = 'rhysd/actionlint:1.7.12';
const workflows = ['workflows/pr.yml', 'workflows/deploy.yml', 'workflows/deploy.problem.yml'];

/**
 * actionlint checks workflow syntax, expressions and their types, `needs` and outputs, runner labels,
 * known action inputs, and the shell in `run:` through ShellCheck. The files are passed explicitly
 * because they live in the kata folder, not in `.github/workflows`.
 */
export const githubActionsValidator: Validator = {
  name: 'workflows',
  checks: [
    {
      title: 'actionlint finds nothing in the workflows',
      run: { image: ACTIONLINT, workdir: 'src/exercises/github-actions-to-aws', args: ['-color', ...workflows] },
    },
  ],
};
