import type { Validator } from '../lib/validator';
import { productionDockerfileValidator } from './production-dockerfile/validation';

/** The Docker-based validators of each exercise, in catalog order. `npm run validate` runs them all. */
export const validators: Validator[] = [productionDockerfileValidator];
