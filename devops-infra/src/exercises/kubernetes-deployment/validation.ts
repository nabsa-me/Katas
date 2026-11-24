import type { Validator } from '../../lib/validator';

const KUBECONFORM = 'ghcr.io/yannh/kubeconform:v0.8.0';

/**
 * kubeconform validates every manifest against the JSON schemas of Kubernetes 1.37.2: `-strict` also
 * rejects unknown fields (a misspelt `readinessprobe` would otherwise be silently ignored). The
 * ExternalSecret is a custom resource with no schema in that set: `-ignore-missing-schemas` skips it,
 * and the summary reports it as skipped.
 */
export const kubernetesDeploymentValidator: Validator = {
  name: 'k8s',
  checks: [
    {
      title: 'kubeconform accepts every manifest (Kubernetes 1.37.2 schemas, strict)',
      run: {
        image: KUBECONFORM,
        workdir: 'src/exercises/kubernetes-deployment',
        args: ['-strict', '-summary', '-kubernetes-version', '1.37.2', '-ignore-missing-schemas', 'k8s'],
      },
    },
  ],
};
