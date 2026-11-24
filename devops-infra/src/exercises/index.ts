import type { Validator } from '../lib/validator';
import { githubActionsValidator } from './github-actions-to-aws/validation';
import { kubernetesDeploymentValidator } from './kubernetes-deployment/validation';
import { productionDockerfileValidator } from './production-dockerfile/validation';
import { terraformValidator } from './terraform-basics/validation';

/** The Docker-based validators of each exercise, in catalog order. `npm run validate` runs them all. */
export const validators: Validator[] = [
  productionDockerfileValidator,
  kubernetesDeploymentValidator,
  githubActionsValidator,
  terraformValidator,
];
