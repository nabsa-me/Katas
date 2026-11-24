# Enforcing the Git flow

## Statement

The team agreed on a flow: every change goes to `main` through a reviewed pull request with green checks, and `main` is always deployable. Nothing enforces it. In one month, a hotfix was pushed straight to `main` and broke the build; a force push rewrote history that a deployment was based on; a pull request was approved, then got one more push that nobody reviewed; and a migration that locked a large table was merged without anyone from the database team seeing it.

Make the agreement enforceable in GitHub, as code:

- A **ruleset** for `main`: changes only through pull requests, with an approval, required status checks, no force pushes, no deletion. Give it as JSON plus the `gh api` command that applies it.
- A **`CODEOWNERS`** file that requires review from the right team for `/migrations`, `/infra` and `/permissions`.
- A **pull request template** with a risk checklist: does it touch the schema, permissions or infrastructure, and what is the rollback plan.

## What gets assessed

- Which rule closes which gap: pull request, approvals, stale approvals, last-push approval, status checks, force push, deletion.
- Rulesets versus classic branch protection, and keeping both the ruleset and the CI job names in sync.
- How CODEOWNERS matches paths (last match wins, anchoring) and how it combines with the ruleset.
- Turning a review into a risk conversation with a template, without making it a form nobody reads.

## How to approach it, step by step

1. Write each incident next to the rule that would have stopped it.
2. Write the ruleset JSON: target `branch`, condition `~DEFAULT_BRANCH`, `enforcement: active` (or `evaluate` first to see what it would block), the rules, and who may bypass it (ideally nobody).
3. Take the required status check names from the CI workflow's job names.
4. Write `CODEOWNERS` from the general to the specific, and check a few paths by hand: the last matching line wins.
5. Write the template with the questions a reviewer must be able to answer from the description.
6. Apply the ruleset with `gh api`, then list the rules that apply to `main` to confirm.

## Solution explained

The files are [`ruleset-main.json`](./ruleset-main.json), [`CODEOWNERS`](./CODEOWNERS) and [`pull_request_template.md`](./pull_request_template.md). In a repository, the last two go in `.github/`.

**Rulesets.** A ruleset is a named set of rules that targets branches or tags by pattern. Compared with classic branch protection, several rulesets can apply to the same branch and they add up (the strictest wins), they can be defined once for a whole organization, they have an `evaluate` mode that reports what would be blocked without blocking it, the bypass list is explicit, and anyone with read access can see which rules apply. This one targets the default branch (`~DEFAULT_BRANCH`, so renaming `main` keeps it protected) with `enforcement: active` and an empty `bypass_actors`: nobody, admins included, skips it. An organization usually allows a small break-glass role to bypass with `bypass_mode: "pull_request"`, so even an emergency change leaves a pull request behind.

**The rules, one per incident.**

| Rule                                                            | What it prevents                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pull_request`                                                  | Direct pushes: every change to `main` is the merge of a pull request.                               |
| `required_approving_review_count: 1`                            | Merging without another person reading it.                                                          |
| `require_code_owner_review: true`                               | Merging a change to `/migrations` without the database team (see CODEOWNERS).                       |
| `dismiss_stale_reviews_on_push: true`                           | An approval that stays valid after the code changes.                                                |
| `require_last_push_approval: true`                              | Someone pushing a final commit to a pull request someone else approved and merging it themselves.   |
| `required_review_thread_resolution: true`                       | Merging with open review comments.                                                                  |
| `required_status_checks` (`lint`, `test`, `build`)              | Merging a red or never-run build.                                                                   |
| `strict_required_status_checks_policy: true`                    | Merging a branch whose checks ran against an older `main` (two green branches can be red together). |
| `non_fast_forward`                                              | Force pushes that rewrite published history.                                                        |
| `deletion`                                                      | Deleting `main`.                                                                                    |
| `required_linear_history` + `allowed_merge_methods: ["squash"]` | Merge commits: one commit per pull request, easy to revert.                                         |

**Status checks must match the job names.** A required check is identified by its `context`, which for GitHub Actions is the job's name: here `lint`, `test` and `build` from [`pr.yml`](../github-actions-to-aws/workflows/pr.yml). If a job is renamed, the ruleset waits forever for a check that never reports, and every pull request is blocked; the test below reads both files to keep them in sync. `integration_id: 15368` (the GitHub Actions app) means only a check run created by GitHub Actions counts, not a commit status any token with access could post. With many contributors, the "up to date" policy forces constant rebases; a merge queue (`merge_queue` rule) is the scalable version: it tests each pull request on top of the ones queued before it.

**Applying it.**

```bash
gh api --method POST repos/OWNER/REPO/rulesets \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  --input ruleset-main.json

gh api repos/OWNER/REPO/rulesets                # list the rulesets and their ids
gh api repos/OWNER/REPO/rules/branches/main     # the rules that apply to main, from every ruleset
```

Updating is `PUT repos/OWNER/REPO/rulesets/<id>` with the same file. Keeping the JSON in a repository (or managing it with the Terraform GitHub provider) gives the rules a review history like any other code.

**CODEOWNERS.** Each line is a pattern and its owners. For a changed file, GitHub uses the **last** line that matches, not every line, so the catch-all `*` goes first and specific paths after it. A leading `/` anchors the pattern at the repository root: `/migrations/` covers `migrations/0007.sql` but not `src/migrations/README.md`. With `require_code_owner_review`, a pull request needs an approval from an owner of every changed file that has owners. The file protects itself (`/.github/CODEOWNERS` needs the security team), otherwise anyone could remove a line in the same pull request that needs it. Owners must have write access to the repository (teams must be visible), or GitHub ignores them and shows an error on the file. [`code-owners.ts`](./code-owners.ts) implements the matching subset used here, to test the file.

**The template.** The checklist does not ask for ceremony; it asks the questions a reviewer would otherwise have to dig for: does it change the schema (and does the running version survive it), who gains or loses access, what the infrastructure diff is, what must exist before deploying, and how to roll back. The rollback section insists that a revert is not a plan after a migration or a data rewrite.

**The flow it supports.** Short-lived branches from `main`, a pull request with green checks and a code owner's approval, squash merge, and the [deploy workflow](../github-actions-to-aws/README.md) promoting `main` through the environments. The ruleset is what turns the agreement into the only possible path.

**How it is proven.** This exercise is configuration, so [`git-flow.test.ts`](./git-flow.test.ts) checks the files themselves: the ruleset targets the default branch, is active, has no bypass, contains `pull_request` (with code owner review, stale review dismissal and last-push approval), `required_status_checks` equal to the job names of `pr.yml` and from GitHub Actions, `non_fast_forward` and `deletion`; CODEOWNERS gives `/migrations`, `/infra` and `/permissions` to the right teams with last-match-wins semantics; and the template asks the three risk questions and for a rollback plan. Applying the ruleset needs a real repository and is not part of the kata.

## Common mistakes

| Symptom                                                 | Cause                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Every pull request waits for a check that never arrives | The required context does not match a job name (renamed job, or `workflow / job` used as the name).            |
| A migration was merged without the database team        | `require_code_owner_review` off, or a later CODEOWNERS line (like `*`) matches the file too.                   |
| An approved pull request changed before merge           | `dismiss_stale_reviews_on_push` or `require_last_push_approval` not set.                                       |
| Admins still push directly to `main`                    | They are in `bypass_actors`, or classic branch protection without "Do not allow bypassing the above settings". |
| CODEOWNERS has no effect for a team                     | The team lacks write access or is secret; GitHub shows the error when viewing the file.                        |
| The ruleset blocks nothing                              | `enforcement` left as `evaluate` or `disabled`, or the `ref_name` condition matches no branch.                 |

## Practice

Add a second ruleset for tags (`target: "tag"`, `refs/tags/v*`) that prevents deleting or moving release tags, and a test that checks it.
