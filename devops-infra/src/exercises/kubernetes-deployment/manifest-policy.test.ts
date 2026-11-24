import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { asArray, at, readText, readYamlDocument } from '../../lib/documents';
import { consistencyFindings, deploymentFindings } from './manifest-policy';

const manifest = (file: string) => readYamlDocument(new URL(`./k8s/${file}`, import.meta.url));

const problem = manifest('deployment.problem.yaml');
const deployment = manifest('deployment.yaml');
const service = manifest('service.yaml');
const configMap = manifest('configmap.yaml');
const secretExample = manifest('secret.example.yaml');
const externalSecret = manifest('external-secret.yaml');
const hpa = manifest('hpa.yaml');
const pdb = manifest('pdb.yaml');

/** A manifest with one text change, to show which mistake each consistency rule catches. */
function variant(file: string, from: string, to: string): unknown {
  const text = readText(new URL(`./k8s/${file}`, import.meta.url));
  expect(text).toContain(from);
  return parse(text.replace(from, to));
}

describe('deployment.problem.yaml', () => {
  it('has no probes, no resources and no security context', () => {
    expect(deploymentFindings(problem)).toEqual([
      'rolling update may remove ready pods before new ones are ready (default maxUnavailable: 25%)',
      'no RuntimeDefault seccomp profile: every system call is allowed',
      'web: no startupProbe: a slow boot races the liveness probe',
      'web: no readinessProbe: traffic arrives before it can answer',
      'web: no livenessProbe: a hung process is never restarted',
      'web: no CPU and memory requests: scheduled blind, and the HPA cannot compute utilization',
      'web: no memory limit: a leak can take memory from every pod on the node',
      'web: image tagged latest: a restart can run a different version',
      'web: runAsNonRoot not set: it may run as root',
      'web: writable root filesystem',
      'web: privilege escalation allowed',
      'web: Linux capabilities not dropped',
    ]);
  });

  it('fixes its replica count, which fights an autoscaler', () => {
    expect(consistencyFindings([problem, hpa])).toContain(
      'spec.replicas set while an HPA owns the count: every apply resets it',
    );
  });
});

describe('deployment.yaml', () => {
  it('follows every production rule', () => {
    expect(deploymentFindings(deployment)).toEqual([]);
  });

  it('fits with the other manifests, using either the example Secret or the ExternalSecret', () => {
    const common = [deployment, service, configMap, hpa, pdb];
    expect(consistencyFindings([...common, secretExample])).toEqual([]);
    expect(consistencyFindings([...common, externalSecret])).toEqual([]);
  });

  it('defines the same Secret name and key in both secret sources', () => {
    expect(at(externalSecret, 'spec', 'target', 'name')).toBe(at(secretExample, 'metadata', 'name'));
    const [entry] = asArray(at(externalSecret, 'spec', 'data'));
    expect(at(entry, 'secretKey')).toBe('database-password');
    expect(at(secretExample, 'stringData', 'database-password')).toBeTypeOf('string');
  });
});

describe('consistencyFindings', () => {
  const others = [configMap, secretExample, hpa, pdb];

  it('catches a Service whose selector matches no pod', () => {
    const typo = variant('service.yaml', 'name: katas-web\n  ports', 'name: katas-webb\n  ports');
    expect(consistencyFindings([deployment, typo, ...others])).toEqual(['Service selector matches no pod']);
  });

  it('catches a reference to a ConfigMap, a Secret key or a port name that does not exist', () => {
    const renamed = [
      variant('deployment.yaml', 'name: katas-web-config', 'name: katas-web-settings'),
      variant('deployment.yaml', 'key: database-password', 'key: password'),
      variant('deployment.yaml', 'port: http', 'port: web'),
    ];
    expect(renamed.map((broken) => consistencyFindings([broken, service, ...others]))).toEqual([
      ['ConfigMap katas-web-settings not defined'],
      ['Secret key katas-web-secrets/password not defined'],
      ['startupProbe port web not defined'],
    ]);
  });
});
