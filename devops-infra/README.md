# devops-infra

Five katas on shipping a web app to AWS, solved and explained: a production Docker image, Kubernetes manifests, a GitHub Actions pipeline with OIDC, branch rules as code, and Terraform. Each exercise puts the flawed version next to the fixed one and proves the difference with linters run in pinned Docker images and with tests that parse the files and check production rules. Nothing is deployed and no cloud account is needed.

## Run

Requires Node 22.12 or later and Docker running (Docker Desktop or Docker Engine). The validators pull their pinned images the first time they run.

```bash
cd devops-infra
npm install
npm test                      # policy tests: Dockerfiles, manifests, workflows, ruleset and CODEOWNERS
npm run check                 # type checking
npm run validate              # every validator below, in Docker
npm run validate:dockerfile   # hadolint on Dockerfile and Dockerfile.problem
npm run validate:k8s          # kubeconform with the Kubernetes 1.37.2 schemas, strict
npm run validate:workflows    # actionlint on the three workflows
npm run validate:terraform    # terraform fmt -check and validate (downloads the AWS provider, about 45 s)
```

Building, measuring and running the sample image, from the kata folder:

```bash
docker build -f src/exercises/production-dockerfile/Dockerfile -t devops-infra-app:production src/exercises/production-dockerfile/app
docker build -f src/exercises/production-dockerfile/Dockerfile.problem -t devops-infra-app:problem src/exercises/production-dockerfile/app
docker image ls devops-infra-app                            # disk usage and content size of both
docker run --rm -p 5811:3000 devops-infra-app:production    # http://localhost:5811 and /api/health
docker image rm devops-infra-app:production devops-infra-app:problem
```

The statement, the explained solution and the common mistakes are in the `README.md` of each exercise folder.

## How to use these katas

1. Read the exercise statement (only the "Statement" section).
2. Try to solve it **yourself, in an empty project, without an assistant**. Official documentation only.
3. If you get stuck, read "How to approach it, step by step" and carry on.
4. When done, compare with the solution and read "Solution explained" and "Common mistakes".
5. Repeat the exercise another day without looking.

| Exercise                                                                        | What it practises                                                                       |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Production Dockerfile](src/exercises/production-dockerfile/README.md)          | Multi-stage builds, Next.js standalone output, non-root, digests, `HEALTHCHECK`         |
| [Kubernetes deployment](src/exercises/kubernetes-deployment/README.md)          | Probes, requests and limits, `securityContext`, rolling updates, HPA, PDB, service mesh |
| [GitHub Actions pipeline to AWS](src/exercises/github-actions-to-aws/README.md) | OIDC roles, trust policies, ECR, promotion by digest, environments, `concurrency`       |
| [Enforcing the Git flow](src/exercises/git-flow-enforcement/README.md)          | Rulesets through the API, required checks, CODEOWNERS, pull request template            |
| [Terraform basics](src/exercises/terraform-basics/README.md)                    | Modules, tfvars per environment, S3 state with locking, secrets out of state, CDK       |

## How each exercise is proven

| Validator or test                          | Image or tool                      | What it proves                                                                    |
| ------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------- |
| `validate:dockerfile`                      | `hadolint/hadolint:v2.15.1`        | Dockerfile instructions and shell; the problem file must report DL3007 (`latest`) |
| `validate:k8s`                             | `ghcr.io/yannh/kubeconform:v0.8.0` | Every manifest matches the Kubernetes 1.37.2 schema, unknown fields rejected      |
| `validate:workflows`                       | `rhysd/actionlint:1.7.12`          | Workflow syntax, expressions, `needs`, action inputs and outputs, ShellCheck      |
| `validate:terraform`                       | `hashicorp/terraform:1.17.2`       | Formatting, and the configuration against the AWS provider 6.74 schema            |
| `npm test` (`*-policy.test.ts` and others) | Vitest, `yaml`                     | The design rules a schema cannot express: probes, OIDC, environments, rulesets…   |

A linter proves that a file is valid; it does not prove that it is safe. The flawed Deployment and the flawed workflow pass kubeconform and actionlint, and the policy tests are what show their flaws.

## Container and Kubernetes cheat sheet

| I need…                              | Use                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| A small image with only what runs    | Multi-stage build; copy build output (Next.js: `output: 'standalone'`) to the last stage      |
| Fast rebuilds                        | Copy `package.json` and the lockfile, `npm ci`, then copy the sources                         |
| The same base image every time       | `FROM image:tag@sha256:<digest>`                                                              |
| Keep files out of the image          | `.dockerignore` (or `<Dockerfile>.dockerignore` next to the Dockerfile)                       |
| Not running as root                  | `USER 1000:1000` in the image, `runAsNonRoot` + `runAsUser` in the pod                        |
| Clean shutdown                       | `CMD ["node", "server.js"]` (exec form), `preStop` sleep, `terminationGracePeriodSeconds`     |
| Traffic only to pods that can answer | `readinessProbe`                                                                              |
| A stuck process restarted            | `livenessProbe` that checks only the process                                                  |
| Slow starts without restart loops    | `startupProbe`                                                                                |
| Rollouts without losing capacity     | `maxUnavailable: 0`, `maxSurge: 1`                                                            |
| Scale on load                        | HPA `autoscaling/v2` on CPU utilization (needs CPU requests), no `replicas` in the Deployment |
| Survive node drains                  | PodDisruptionBudget `maxUnavailable: 1` and at least two replicas                             |
| Secrets from AWS in the cluster      | External Secrets Operator `ExternalSecret` → Kubernetes Secret                                |

## Pipeline and infrastructure cheat sheet

| I need…                                        | Use                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| AWS credentials in GitHub Actions without keys | `permissions: id-token: write` + `aws-actions/configure-aws-credentials` with `role-to-assume`          |
| Only production jobs can assume the prod role  | Trust policy `StringEquals` on `aud` = `sts.amazonaws.com` and `sub` = `repo:ORG/REPO:environment:prod` |
| Approvals before production                    | GitHub environment with required reviewers, and `environment: prod` on the job                          |
| One deployment per environment at a time       | `concurrency: { group: deploy-prod, cancel-in-progress: false }`                                        |
| Deploy exactly what was tested                 | Build once, tag with `github.sha`, promote the image digest                                             |
| No direct or force pushes to `main`            | Ruleset with `pull_request`, `non_fast_forward`, `deletion`                                             |
| A team must review a path                      | `CODEOWNERS` line (last match wins) + `require_code_owner_review`                                       |
| One state per environment, locked              | S3 backend with `use_lockfile = true`, `-backend-config=envs/<env>.s3.tfbackend`                        |
| A database password out of the Terraform state | `manage_master_user_password = true`; write-only `secret_string_wo` + ephemeral variable                |
| Validate Terraform without an account          | `terraform init -backend=false` + `terraform validate`                                                  |

Rule of thumb: make the safe path the only path (rules, policies and pipelines), and measure (sizes, rollouts, plans) instead of trusting a review.
