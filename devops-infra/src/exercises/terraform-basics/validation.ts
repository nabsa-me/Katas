import type { Validator } from '../../lib/validator';

const TERRAFORM = 'hashicorp/terraform:1.17.2';
const workdir = 'src/exercises/terraform-basics/terraform';

/**
 * No AWS account and no state: `fmt -check` compares the formatting, and `validate` checks syntax,
 * types, references and every resource argument against the AWS provider schema. `init -backend=false`
 * skips the S3 backend, `-lockfile=readonly` installs exactly the providers of the committed lock file,
 * and TF_DATA_DIR keeps the downloaded provider inside the container instead of the kata folder.
 */
export const terraformValidator: Validator = {
  name: 'terraform',
  checks: [
    {
      title: 'terraform fmt finds nothing to reformat',
      run: { image: TERRAFORM, workdir, args: ['fmt', '-check', '-recursive', '-diff'] },
    },
    {
      title: 'terraform validate accepts the configuration with the locked AWS provider',
      run: {
        image: TERRAFORM,
        workdir,
        entrypoint: '/bin/sh',
        env: { TF_DATA_DIR: '/tmp/terraform', TF_IN_AUTOMATION: '1' },
        args: ['-c', 'terraform init -backend=false -input=false -lockfile=readonly && terraform validate'],
      },
    },
  ],
};
