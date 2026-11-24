<!-- Goes in .github/pull_request_template.md. GitHub pre-fills every new pull request with it. -->

## What and why

<!-- What changes and which problem it solves. Link the issue. -->

## How it was tested

- [ ] Tests added or updated for the change
- [ ] Tried in a deployed environment (or explain why it was not needed)

## Risk

- [ ] **Database schema or migrations** (`/migrations`): does the running version keep working before and after it (expand/contract)? Does it lock or rewrite a large table?
- [ ] **Permissions** (`/permissions`, IAM policies, roles, RBAC): who gains or loses access?
- [ ] **Infrastructure** (`/infra`, Terraform, Kubernetes, workflows): what does `terraform plan` or the diff of the manifests show?
- [ ] **Configuration or secrets** that must exist before this is deployed
- [ ] None of the above

## Rollback plan

<!--
How to undo it if it goes wrong, and how long it takes. "Revert the commit" is not enough when a
migration has run, data was rewritten or a resource was replaced: say what else is needed.
-->
