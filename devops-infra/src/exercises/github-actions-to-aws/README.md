# GitHub Actions pipeline to AWS

## Statement

The app from the [production Dockerfile](../production-dockerfile/README.md) is deployed to EKS with this workflow on every push to `main`:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: npm install
      - run: npm test
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      - run: |
          docker build -t 111122223333.dkr.ecr.eu-west-1.amazonaws.com/katas-web:latest .
          docker push 111122223333.dkr.ecr.eu-west-1.amazonaws.com/katas-web:latest
      - run: kubectl rollout restart deployment/katas-web
```

It works. The security review finds an access key that has not been rotated in two years and works from any laptop; nobody can say which commit runs in production; a bad commit goes straight to production with nobody approving it; two quick pushes deploy at the same time; and pull requests are never checked. Rebuild it as a `pr.yml` (lint, test, build) and a `deploy.yml` that authenticates with OIDC, tags the image with the commit SHA, pushes it to ECR, and promotes it through dev → int → stag → prod with protected environments and `concurrency`. Document the IAM role's trust policy.

## What gets assessed

- OIDC federation between GitHub Actions and AWS, and why it replaces stored access keys.
- A trust policy that names the repository and the environment, and the token claims it checks (`aud`, `sub`).
- Build once, promote the same artifact: immutable SHA tags, deployment by digest.
- GitHub environments, protection rules and `concurrency` for ordered, approved, one-at-a-time deployments.
- Least privilege for the `GITHUB_TOKEN`, the AWS roles and the actions themselves (pinning).

## How to approach it, step by step

1. Separate what checks a change (pull requests: lint, test, build, no credentials) from what ships it (pushes to `main`).
2. Create an IAM OIDC identity provider for `https://token.actions.githubusercontent.com` (audience `sts.amazonaws.com`) once per AWS account.
3. Create the roles: one that may push to ECR from `main`, one per environment that may deploy. Write each trust policy with exact `aud` and `sub` conditions.
4. In the workflow, set `permissions` at the top (read-only) and add `id-token: write` only to the jobs that assume a role; replace the keys with `role-to-assume`.
5. Build and push once, tagged with `github.sha`; pass the digest to the deploy jobs as a job output.
6. One deploy job per environment, each with `environment:`, `needs:` on the previous one, and a `concurrency` group; configure reviewers on `stag` and `prod` in the repository settings.
7. Run actionlint (`npm run validate:workflows`) and the policy tests (`npm test`).

## Solution explained

The workflows are [`workflows/pr.yml`](./workflows/pr.yml), [`workflows/deploy.yml`](./workflows/deploy.yml) and the flawed [`workflows/deploy.problem.yml`](./workflows/deploy.problem.yml); the IAM documents are [`iam/trust-policy.json`](./iam/trust-policy.json) and [`iam/deploy-permissions.json`](./iam/deploy-permissions.json). They are written for a repository whose root holds the app, its `Dockerfile` and `lint` and `test` scripts; in a real repository they go in `.github/workflows/`.

**Pull requests.** `pr.yml` runs `lint` and `test` in parallel and then `build`, which builds the production image without pushing it, so a broken Dockerfile fails the pull request and not the deployment. The token can only read (`permissions: contents: read`), no secret or AWS role is used (pull requests from forks must never get them), and `concurrency` with `cancel-in-progress: true` stops the run of a push that a newer push replaced. The three job names are the status checks the [branch ruleset](../git-flow-enforcement/README.md) requires.

**OIDC instead of keys.** With `permissions: id-token: write`, a job can ask GitHub for a short-lived JWT signed by `https://token.actions.githubusercontent.com`. `aws-actions/configure-aws-credentials` with `role-to-assume` sends it to STS (`AssumeRoleWithWebIdentity`); AWS checks the signature against the IAM OIDC provider of the account, evaluates the role's trust policy against the token's claims, and returns credentials that expire in an hour. Nothing is stored in GitHub, nothing can be copied to a laptop, and revoking access is editing a trust policy. The static keys in the problem are valid anywhere, until someone rotates them by hand.

**The trust policy.** [`iam/trust-policy.json`](./iam/trust-policy.json) is the prod deploy role's:

```json
"Condition": {
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": "repo:ORG/REPO:environment:prod"
  }
}
```

`aud` proves the token was minted for AWS STS. `sub` says who is asking: a job that declares `environment: prod` gets `repo:ORG/REPO:environment:prod`, a job without an environment gets `repo:ORG/REPO:ref:refs/heads/main` (or `:pull_request` on a pull request). Only jobs in the `prod` environment of this repository can assume the role, and GitHub only starts those after the environment's protection rules pass, so the approval in GitHub is also the gate in AWS. `StringEquals` with the exact value matters: `StringLike` with `repo:ORG/*` would let any repository of the organization deploy to production. The build role trusts `ref:refs/heads/main` instead, so only pushes to `main` can push images:

```json
"StringEquals": {
  "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
  "token.actions.githubusercontent.com:sub": "repo:ORG/REPO:ref:refs/heads/main"
}
```

Repositories created, renamed or transferred after 2026-07-15 receive the immutable format `repo:OWNER@OWNER-ID/REPO@REPO-ID:environment:prod` ([GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)): the numeric ids do not change if a name is later reused by another owner or repository. Older repositories keep the name format unless they opt in.

**Role permissions.** The deploy role can only call `eks:DescribeCluster` on one cluster ([`iam/deploy-permissions.json`](./iam/deploy-permissions.json)), which `aws eks update-kubeconfig` needs. What it may do inside the cluster comes from an EKS access entry, scoped to the app's namespace (`aws eks create-access-entry` and `aws eks associate-access-policy` with `--access-scope type=namespace,namespaces=katas`; ⚠️ Verify: not run here, see [EKS access entries](https://docs.aws.amazon.com/eks/latest/userguide/access-entries.html)). The nodes pull the image with their own role, so the deploy role needs no ECR access. The build role has `ecr:GetAuthorizationToken` (account-wide by design) and the push actions on the repository ARN only: `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`, `ecr:BatchGetImage`.

**Build once, promote by digest.** The `build` job pushes `…/katas-web:<commit SHA>` (with tag immutability on in the ECR repository, a tag can never point to other bytes) and exposes `registry/repository@sha256:…` as the job output `image`, built from `docker/build-push-action`'s `digest` output. Every deploy job runs `kubectl set image deployment/katas-web web="$IMAGE"` with that output, so production runs the exact bytes that passed dev, int and stag; rebuilding per environment would give different bytes (new base layers, new dependency resolution). `kubectl rollout status` waits for the readiness probes of the [Kubernetes exercise](../kubernetes-deployment/README.md); if the rollout fails, `kubectl rollout undo` returns to the previous ReplicaSet and the promotion stops.

**Environments.** `deploy-dev` → `deploy-int` → `deploy-stag` → `deploy-prod`, each with `needs:` on the previous job and `environment:` set. The rules live in the repository settings, one environment each: required reviewers for `stag` and `prod` (with "prevent self-review"), deployment branches limited to `main`, and environment variables `AWS_DEPLOY_ROLE_ARN` (one role per AWS account) and `EKS_CLUSTER`. The same job text deploys to any environment; the environment decides where. GitHub records every deployment per environment, which answers "which commit is in prod".

**Concurrency.** Each deploy job has `concurrency: { group: deploy-<env>, cancel-in-progress: false }`: one deployment per environment at a time, a running rollout is never cancelled half-way, and if several runs queue up only the newest pending one is kept. Pull requests use `cancel-in-progress: true` because cancelling a check is harmless.

**Token and action hygiene.** The workflow sets `permissions: contents: read` at the top, and only jobs that assume a role add `id-token: write`. Values reach shell scripts through `env:` (`"$IMAGE"`), never by writing `${{ … }}` inside `run:`, where attacker-controlled text such as a pull request title becomes shell code. Actions are referenced by major version (`@v7`) for readability; a tag can be moved, as in the March 2025 compromise of `tj-actions/changed-files`, so high-assurance repositories pin each action to a full commit SHA with the version in a comment (`actions/checkout@<40-hex SHA> # v7.0.1`) and let Dependabot update them.

**How it is proven.** `npm run validate:workflows` runs actionlint 1.7.12 on the three files: no findings. actionlint checks syntax, expression types, `needs`, job outputs, runner labels, known action inputs and outputs (a typo such as `steps.push.outputs.digests` is reported), and the `run:` scripts through ShellCheck. The flawed workflow passes too: it is valid, only unsafe. [`workflow-policy.ts`](./workflow-policy.ts) checks the design and [`workflow-policy.test.ts`](./workflow-policy.test.ts) proves it: the problem breaks five rules (no top-level permissions, static keys, `latest`, a single job, no environments), `deploy.yml` none; the tests also check that every environment deploys the build's digest, that only the five AWS jobs get `id-token: write`, that `pr.yml` has no secrets, and that the trust policy pins `aud` and `sub` with `StringEquals`.

## Common mistakes

| Symptom                                                   | Cause                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Could not load credentials from any providers`           | `permissions: id-token: write` missing on the job (or overridden by a job-level `permissions` block).  |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | The token's `sub` does not match the trust policy, often because the job has (or lacks) `environment`. |
| Any branch or pull request can assume the production role | `StringLike` with `repo:ORG/REPO:*` (or `repo:ORG/*`) in the trust policy.                             |
| Production runs an image nobody tested                    | The image is rebuilt per environment, or deployed by a mutable tag instead of the digest.              |
| Two deployments to the same environment interleave        | No `concurrency` group, or `cancel-in-progress: true` on deploy jobs.                                  |
| `Skip output 'image' since it may contain secret`         | A masked value (the AWS account id, when masking is enabled) inside a job output.                      |
| Every job can write to the repository                     | No `permissions` block: jobs get the repository's default token permissions.                           |

## Practice

Add a manual `workflow_dispatch` trigger that redeploys an earlier digest to a chosen environment (a rollback without rebuilding), and decide which role and which protection rules it must go through.
