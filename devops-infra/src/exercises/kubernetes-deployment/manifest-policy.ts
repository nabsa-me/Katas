import { asArray, asString, at, isRecord } from '../../lib/documents';

/**
 * Production rules for a Deployment that a schema cannot express: kubeconform accepts a Deployment
 * without probes or limits, because every one of those fields is optional. Each finding says what is
 * missing and what it costs.
 */
export function deploymentFindings(deployment: unknown): string[] {
  const pod = at(deployment, 'spec', 'template', 'spec');
  const podSecurity = at(pod, 'securityContext');
  const findings: string[] = [];

  if (at(deployment, 'spec', 'strategy', 'rollingUpdate', 'maxUnavailable') !== 0) {
    findings.push('rolling update may remove ready pods before new ones are ready (default maxUnavailable: 25%)');
  }
  if (at(podSecurity, 'seccompProfile', 'type') !== 'RuntimeDefault') {
    findings.push('no RuntimeDefault seccomp profile: every system call is allowed');
  }
  for (const container of asArray(at(pod, 'containers'))) {
    const name = asString(at(container, 'name')) ?? 'unnamed';
    const missing = (what: string) => findings.push(`${name}: ${what}`);
    const security = (key: string) => at(container, 'securityContext', key) ?? at(podSecurity, key);

    if (!isRecord(at(container, 'startupProbe'))) missing('no startupProbe: a slow boot races the liveness probe');
    if (!isRecord(at(container, 'readinessProbe'))) missing('no readinessProbe: traffic arrives before it can answer');
    if (!isRecord(at(container, 'livenessProbe'))) missing('no livenessProbe: a hung process is never restarted');
    const requests = at(container, 'resources', 'requests');
    if (at(requests, 'cpu') === undefined || at(requests, 'memory') === undefined) {
      missing('no CPU and memory requests: scheduled blind, and the HPA cannot compute utilization');
    }
    if (at(container, 'resources', 'limits', 'memory') === undefined) {
      missing('no memory limit: a leak can take memory from every pod on the node');
    }
    const image = asString(at(container, 'image')) ?? '';
    if (!image.includes('@sha256:') && !/:[\w.-]+$/.test(image.split('/').at(-1) ?? '')) {
      missing('image without tag or digest: it means latest');
    } else if (image.endsWith(':latest')) {
      missing('image tagged latest: a restart can run a different version');
    }
    if (security('runAsNonRoot') !== true) missing('runAsNonRoot not set: it may run as root');
    if (security('readOnlyRootFilesystem') !== true) missing('writable root filesystem');
    if (security('allowPrivilegeEscalation') !== false) missing('privilege escalation allowed');
    if (!asArray(at(container, 'securityContext', 'capabilities', 'drop')).includes('ALL')) {
      missing('Linux capabilities not dropped');
    }
  }
  return findings;
}

function matches(selector: unknown, labels: unknown): boolean {
  return (
    isRecord(selector) &&
    Object.keys(selector).length > 0 &&
    Object.entries(selector).every(([key, value]) => at(labels, key) === value)
  );
}

function byKind(documents: unknown[], kind: string): unknown[] {
  return documents.filter((document) => at(document, 'kind') === kind);
}

/**
 * Checks that the manifests fit together: selectors that pick the Deployment's pods, an HPA that
 * targets it, and every referenced ConfigMap, Secret key and named port defined somewhere.
 * Each of these mistakes passes schema validation and only shows up after `kubectl apply`.
 */
export function consistencyFindings(documents: unknown[]): string[] {
  const [deployment] = byKind(documents, 'Deployment');
  if (!deployment) return ['no Deployment'];
  const name = at(deployment, 'metadata', 'name');
  const podLabels = at(deployment, 'spec', 'template', 'metadata', 'labels');
  const containers = asArray(at(deployment, 'spec', 'template', 'spec', 'containers'));
  const portNames = containers.flatMap((c) => asArray(at(c, 'ports')).map((p) => at(p, 'name')));
  const findings: string[] = [];

  for (const service of byKind(documents, 'Service')) {
    if (!matches(at(service, 'spec', 'selector'), podLabels)) findings.push('Service selector matches no pod');
    for (const port of asArray(at(service, 'spec', 'ports'))) {
      const target = at(port, 'targetPort');
      if (typeof target === 'string' && !portNames.includes(target)) {
        findings.push(`Service targetPort ${target} is not a container port name`);
      }
    }
  }
  for (const pdb of byKind(documents, 'PodDisruptionBudget')) {
    if (!matches(at(pdb, 'spec', 'selector', 'matchLabels'), podLabels)) findings.push('PDB selector matches no pod');
  }
  const hpas = byKind(documents, 'HorizontalPodAutoscaler');
  if (!hpas.some((hpa) => at(hpa, 'spec', 'scaleTargetRef', 'name') === name)) {
    findings.push('no HorizontalPodAutoscaler targets the Deployment');
  } else if (at(deployment, 'spec', 'replicas') !== undefined) {
    findings.push('spec.replicas set while an HPA owns the count: every apply resets it');
  }

  const configMaps = byKind(documents, 'ConfigMap').map((c) => at(c, 'metadata', 'name'));
  const secretKeys = new Map<unknown, unknown[]>();
  for (const secret of byKind(documents, 'Secret')) {
    const keys = [at(secret, 'stringData'), at(secret, 'data')].flatMap((d) => (isRecord(d) ? Object.keys(d) : []));
    secretKeys.set(at(secret, 'metadata', 'name'), keys);
  }
  for (const external of byKind(documents, 'ExternalSecret')) {
    const keys = asArray(at(external, 'spec', 'data')).map((d) => at(d, 'secretKey'));
    secretKeys.set(at(external, 'spec', 'target', 'name'), keys);
  }
  for (const container of containers) {
    for (const source of asArray(at(container, 'envFrom'))) {
      const ref = at(source, 'configMapRef', 'name');
      if (ref !== undefined && !configMaps.includes(ref)) findings.push(`ConfigMap ${String(ref)} not defined`);
    }
    for (const variable of asArray(at(container, 'env'))) {
      const ref = at(variable, 'valueFrom', 'secretKeyRef');
      if (ref !== undefined && !secretKeys.get(at(ref, 'name'))?.includes(at(ref, 'key'))) {
        findings.push(`Secret key ${String(at(ref, 'name'))}/${String(at(ref, 'key'))} not defined`);
      }
    }
    for (const probe of ['startupProbe', 'readinessProbe', 'livenessProbe']) {
      const port = at(container, probe, 'httpGet', 'port');
      if (typeof port === 'string' && !portNames.includes(port)) findings.push(`${probe} port ${port} not defined`);
    }
  }
  return findings;
}
