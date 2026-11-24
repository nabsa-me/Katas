# Kubernetes deployment

## Statement

The image from the [production Dockerfile](../production-dockerfile/README.md) runs in Kubernetes with this Deployment:

```yaml
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: web
          image: 111122223333.dkr.ecr.eu-west-1.amazonaws.com/katas-web:latest
          ports:
            - containerPort: 3000
```

It is valid and it runs. Symptoms in production: every deploy returns errors for a few seconds, a pod that hangs keeps receiving traffic until someone deletes it, one pod used all the memory of its node, a node drain took the site down, and the security review flags the container as root with a writable filesystem. Write the production version: readiness, liveness and startup probes, requests and limits, a `securityContext` (non-root, read-only filesystem) and a rolling-update strategy, plus the Service, ConfigMap, Secret (with External Secrets as the real source), HorizontalPodAutoscaler and PodDisruptionBudget. Then explain what a service mesh would take off the application's hands.

## What gets assessed

- The three probes and why each exists: startup, readiness and liveness answer different questions.
- Requests and limits: what the scheduler, the autoscaler and the kernel do with each.
- A restrictive `securityContext` that the image actually supports (numeric user, writable folders as volumes).
- Zero-downtime rollouts: `maxUnavailable: 0`, readiness, `preStop`, the termination grace period, the PDB.
- How the pieces reference each other (labels, selectors, names, port names) and how to validate them before `kubectl apply`.

## How to approach it, step by step

1. List what the cluster needs to know about the container: when it has started, when it can take traffic, when it is stuck, how much CPU and memory it needs, and what it is allowed to do.
2. Add the probes against the app's `/api/health`, with a startup probe generous enough for a cold start.
3. Measure or estimate usage and set requests; set a memory limit; decide on a CPU limit.
4. Add the pod and container `securityContext`; run the image read-only locally first (`docker run --read-only --tmpfs …`) to find which paths must be writable.
5. Set the rolling-update strategy, the `preStop` pause and the grace period.
6. Write the Service, ConfigMap, Secret, ExternalSecret, HPA and PDB, all selecting the same pod labels; remove `replicas` from the Deployment.
7. Validate with kubeconform (`npm run validate:k8s`) and with the policy tests (`npm test`); optionally apply to a local `kind` cluster.

## Solution explained

The manifests are in [`k8s/`](./k8s/): [`deployment.yaml`](./k8s/deployment.yaml) (the flawed one is [`deployment.problem.yaml`](./k8s/deployment.problem.yaml)), [`service.yaml`](./k8s/service.yaml), [`configmap.yaml`](./k8s/configmap.yaml), [`secret.example.yaml`](./k8s/secret.example.yaml), [`external-secret.yaml`](./k8s/external-secret.yaml), [`hpa.yaml`](./k8s/hpa.yaml) and [`pdb.yaml`](./k8s/pdb.yaml).

**Three probes, three questions.**

- **Startup** (`periodSeconds: 2`, `failureThreshold: 30`): "has it finished booting?" It allows up to 60 seconds, and the other two probes only start after it succeeds. Without it, a slow cold start needs a long `initialDelaySeconds` on liveness, which also delays detecting a hang later.
- **Readiness** (every 5 s): "can it take traffic now?" A failing pod is removed from the Service endpoints but not restarted. During a rollout, a new pod only receives traffic once it is ready, which is what removes the errors on deploy.
- **Liveness** (every 10 s, 3 failures, 2 s timeout): "is it stuck for good?" A failing pod is restarted. It must only check the process itself: if it checked the database, a database outage would restart every pod at once and make the outage worse.

All three use `/api/health`, which checks only the server. An app with dependencies it cannot serve without would add a separate readiness endpoint that checks them (the production-health kata covers it).

**Requests and limits.** Requests (`cpu: 100m`, `memory: 256Mi`) are what the scheduler reserves when it picks a node, and the base of the HPA's utilization percentage, so an HPA on CPU without a CPU request cannot work. The memory limit is what the kernel enforces: above it the container is OOM-killed instead of starving its neighbours. Memory request equal to the limit avoids overcommitting a node's memory. The CPU limit (`"1"`) is debatable: exceeding it throttles the container even when the node is idle, so many teams set only a CPU request; keep one when tenants must be isolated.

**`securityContext`.** At pod level: `runAsNonRoot: true` with `runAsUser: 1000` and `runAsGroup: 1000` (a numeric user, so the kubelet can verify it; the image also declares `USER 1000:1000`), and the `RuntimeDefault` seccomp profile, which blocks rarely needed system calls. At container level: `allowPrivilegeEscalation: false` (no setuid gains), `capabilities: drop: ["ALL"]` (a web server on port 3000 needs none), and `readOnlyRootFilesystem: true`. The app still needs two writable paths, mounted as `emptyDir` volumes with a size limit: `/tmp` and `/app/.next/cache`. `automountServiceAccountToken: false` keeps a Kubernetes API token out of a pod that never calls the API.

**Rolling update without errors.** `maxSurge: 1` and `maxUnavailable: 0` start one new pod, wait until it is ready, then stop one old pod, so serving capacity never drops below the desired count. When a pod is stopped, the endpoint removal and the `SIGTERM` happen in parallel, and kube-proxy or the load balancer may still send requests for a moment. The `preStop` hook (`sleep: seconds: 5`, a built-in handler that needs no `sleep` binary in the image) delays the `SIGTERM` until the removal has spread; the Next.js server then stops cleanly (measured in the Dockerfile exercise). `terminationGracePeriodSeconds: 30` covers the pause plus in-flight requests. `revisionHistoryLimit: 5` keeps the old ReplicaSets that `kubectl rollout undo` needs.

**Service.** A `ClusterIP` Service selects the pods by `app.kubernetes.io/name` and targets the port by name (`targetPort: http`), so the container port can change in one place. An Ingress or a Gateway API `HTTPRoute` would expose it outside the cluster.

**ConfigMap and Secret.** Non-secret settings go in the ConfigMap and reach the container with `envFrom`; values injected as environment variables are read at start-up, so a change needs a rollout. The password comes from the Secret `katas-web-secrets` through `secretKeyRef`. A Secret is only base64-encoded: anyone who can read it in the namespace (or in Git) has the value. That is why `secret.example.yaml` holds a placeholder for local clusters only, and real clusters use [`external-secret.yaml`](./k8s/external-secret.yaml): the External Secrets Operator reads `katas/prod/app-database` from AWS Secrets Manager through a `ClusterSecretStore` (authenticated with IRSA or EKS Pod Identity, never static keys), writes the same Secret name and key, and refreshes it every hour, so a rotation in Secrets Manager reaches the cluster without a commit. The alternative is the Secrets Store CSI Driver, which mounts the values as files instead of creating a Secret.

**HorizontalPodAutoscaler.** `autoscaling/v2` keeps average CPU utilization near 70 % of the request, between 2 and 10 pods, and waits 5 minutes of lower load before scaling down to avoid flapping. The Deployment has no `replicas` field: if it had one, every `kubectl apply` would reset the count the HPA chose (the policy test catches it). Two replicas minimum means one pod can be restarted or evicted while the other serves.

**PodDisruptionBudget.** `maxUnavailable: 1` lets a node drain or a cluster upgrade evict only one pod of this app at a time: the eviction API refuses the next eviction until the replacement pod is ready, and `kubectl drain` retries. It covers voluntary disruptions only: crashes and node failures are covered by replicas and readiness. `maxUnavailable` keeps working when the HPA changes the count, whereas `minAvailable: 2` with 2 replicas would block every drain.

**Service mesh.** A mesh (Istio, Linkerd) adds a proxy next to each pod (a sidecar, or a per-node proxy in Istio's ambient mode) that handles the traffic between services. What the application no longer has to do:

| Concern                      | Without a mesh, in every service            | With a mesh, in configuration                                   |
| ---------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| Encryption between services  | TLS certificates, rotation, client config   | Automatic mTLS with certificates issued and rotated by the mesh |
| Service identity and authz   | Shared secrets or tokens between services   | Policies by workload identity (`AuthorizationPolicy` in Istio)  |
| Retries and timeouts         | A retry library and timeouts in each client | Route rules per destination (retries, per-try timeout, budget)  |
| Circuit breaking, outliers   | Hand-written breakers                       | Connection limits and outlier detection                         |
| Golden metrics and tracing   | Instrumentation in each service             | Request rate, errors and latency per route from the proxies     |
| Canary and traffic splitting | Several Deployments and a custom router     | Weighted routes between versions                                |

What stays with the application: retries are only safe for idempotent operations (a retried `POST` can charge twice), so the app still needs idempotency keys; it must propagate trace headers for traces to connect; it decides business-level authorization; and it still needs correct readiness and graceful shutdown. The costs are an extra hop of latency, the proxies' CPU and memory, and one more system to operate and upgrade.

**Trying it on kind (optional).** With [kind](https://kind.sigs.k8s.io/) installed, from the kata folder: `kind create cluster --name devops-infra`, build the production image, `kind load docker-image devops-infra-app:production --name devops-infra`, `kubectl apply -f src/exercises/kubernetes-deployment/k8s/` without `external-secret.yaml` (it needs the operator), then `kubectl set image deployment/katas-web web=devops-infra-app:production` and `kubectl rollout status deployment/katas-web`. The HPA needs metrics-server to read CPU. Delete it with `kind delete cluster --name devops-infra`. ⚠️ Verify: these steps were not run as part of the kata; see the [kind quick start](https://kind.sigs.k8s.io/docs/user/quick-start/).

**How it is proven.** `npm run validate:k8s` runs kubeconform 0.8.0 with `-strict -summary -kubernetes-version 1.37.2 -ignore-missing-schemas`: 7 resources valid, 0 invalid, and the ExternalSecret skipped because it is a custom resource without a schema in the Kubernetes set. `-strict` rejects unknown fields, so a misspelt `readinessprobe` fails instead of being ignored. The problem Deployment is valid too: a schema cannot say that probes are required. That is the job of [`manifest-policy.ts`](./manifest-policy.ts) and [`manifest-policy.test.ts`](./manifest-policy.test.ts): `deploymentFindings` lists every missing production rule (twelve for the problem, none for the solution), and `consistencyFindings` checks that the selectors match the pod labels, the HPA targets the Deployment without a competing `replicas`, and every referenced ConfigMap, Secret key and port name exists; the tests break each reference on purpose to show it is caught.

## Common mistakes

| Symptom                                          | Cause                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Errors for a few seconds on every deploy         | No readiness probe, `maxUnavailable` above 0, or no `preStop` pause before `SIGTERM`.          |
| Pods restart in a loop during a slow start       | Liveness probe without a startup probe (or with a short delay) kills the pod while it boots.   |
| Every pod restarts when the database goes down   | The liveness probe checks dependencies; it should check only the process.                      |
| `CreateContainerConfigError: … non-numeric user` | `runAsNonRoot: true` with an image whose `USER` is a name; use a numeric uid.                  |
| `EROFS: read-only file system` at runtime        | `readOnlyRootFilesystem` without `emptyDir` volumes for the paths the app writes.              |
| The HPA shows `<unknown>` utilization            | No CPU request on the container, or metrics-server is not installed.                           |
| The replica count jumps back after each deploy   | `spec.replicas` in the Deployment while an HPA manages it.                                     |
| `kubectl drain` hangs forever                    | A PDB that allows no disruption (`minAvailable` equal to the replica count).                   |
| The Service has no endpoints                     | Its selector does not match the pod template labels (a typo, or a label changed in one place). |

## Practice

Add `topologySpreadConstraints` so the replicas spread across availability zones, and extend `consistencyFindings` to report a Deployment whose pod labels the spread constraint does not select.
