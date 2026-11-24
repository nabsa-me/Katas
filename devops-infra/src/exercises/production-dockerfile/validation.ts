import type { Validator } from '../../lib/validator';

const HADOLINT = 'hadolint/hadolint:v2.15.1';
const workdir = 'src/exercises/production-dockerfile';

/** hadolint lints Dockerfile instructions, and the shell inside RUN through ShellCheck. */
export const productionDockerfileValidator: Validator = {
  name: 'dockerfile',
  checks: [
    {
      title: 'hadolint finds nothing in the production Dockerfile',
      run: { image: HADOLINT, workdir, args: ['hadolint', 'Dockerfile'] },
    },
    {
      title: 'hadolint reports the flaws of Dockerfile.problem',
      run: { image: HADOLINT, workdir, args: ['hadolint', 'Dockerfile.problem'] },
      expectedFindings: ['DL3007'],
    },
  ],
};
