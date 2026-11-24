---
name: release-checklist
description: Checks whether a service is ready to release before a version is tagged or deployed to production. Covers pending database migrations (with a bundled script), changes since the last release, changelog, CI, feature flags and the rollback plan, and ends with a ready or blocking report. Use when the user is preparing, cutting, tagging or shipping a release, or asks if a branch or version can go to production. Do not use for writing release notes alone, explaining versioning, deploying to development or preview environments, or setting up a new project.
allowed-tools:
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/check-pending-migrations.mjs *)
  - Bash(git log *)
  - Bash(git describe *)
---

# Release checklist

Check the release before anyone tags or deploys it, and report each item as **ready**, **blocking** or **needs a decision**, with its evidence (command output, file or link). Never tag, push or deploy yourself: the person releasing does that after reading the report. If something cannot be checked, say so; never report an item as ready without evidence.

## Steps

1. **Identify the release.** The service, the version to release (ask if the user did not say), the commit or branch, and the version in production (usually the latest tag: `git describe --tags --abbrev=0`).
2. **Pending migrations.** Find the migrations directory (usually `db/migrations`) and a file with the versions applied in production, one per line (ask for it if the repository has none; with dbmate it is the output of `SELECT version FROM schema_migrations`). Run:

   `node ${CLAUDE_SKILL_DIR}/scripts/check-pending-migrations.mjs --dir <migrations directory> --applied <applied versions file>`
   - Exit code 0: **ready**.
   - Exit code 1: for each pending migration, read it and check that the version still running can live with it (expand and contract: no renamed or dropped column that the current code uses, no table lock on a large table), and that it runs before the deploy. Otherwise it is **blocking**.
   - A migration marked OUT OF ORDER is **blocking** until someone confirms how the migration tool will apply it.
   - Exit code 2: the check could not run; report the error as **blocking**.

3. **Changes since the last release.** Run `git log --oneline <production tag>..HEAD` and summarize the changes. Anything touching authentication, permissions, payments, infrastructure or data deletion **needs a decision** from a second reviewer.
4. **Changelog.** `CHANGELOG.md` has an entry for this version that covers the changes from step 3.
5. **CI.** The commit being released passed CI on the main branch. Ask for the link if you cannot see it.
6. **Feature flags.** New behaviour behind a flag is off in production by default; list the flag names.
7. **Rollback plan.** How to go back to the version in production (redeploy the previous tag or image), and which migrations from step 2 cannot be undone.

## Report

End with a table of every item, its status and its evidence. The release is ready only when every item is **ready**.
