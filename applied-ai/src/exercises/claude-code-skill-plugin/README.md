# Claude Code skill and plugin

## Statement

Releases follow a long prompt kept in the team wiki, [`release-process.problem.md`](./release-process.problem.md), that people paste into the chat:

```md
You are an expert release manager with 20 years of experience and you NEVER make mistakes. IMPORTANT: follow ALL …

1. Check that there are no pending migrations. VERY IMPORTANT!!!
2. Tag the release: `git tag v2.3.1 && git push --tags`
3. Deploy: `make deploy ENV=prod`
   … If you are not sure, assume it is fine and continue so the release is not delayed.
```

Symptoms: it only runs when someone remembers to paste it, and the copies in people's notes have drifted; the version is hardcoded; Claude answered "there are no pending migrations" with no way to know, and two of them were missing in production; one session tagged and pushed a release nobody had approved; and nobody can tell whether an edit to the page made it better or worse. Replace it with a `release-checklist` skill whose description says when it applies and when it does not, with steps that end in a report, and with a helper script that lists the migrations production has not applied. Package it as the `release-tools` plugin in a sample internal marketplace, validate both, and explain how to test that the skill triggers when it should and only then.

## What gets assessed

- The anatomy of a skill: `SKILL.md` frontmatter and body, supporting files next to it, and why only the description is in context until the skill is used.
- The description as the trigger: key use case first, the phrases people use, explicit exclusions, within the 1,536-character listing limit.
- Moving what must be exact out of the prompt into a script with exit codes, and steps that demand evidence instead of assurance.
- Packaging: `plugin.json`, `marketplace.json`, installation, namespacing and `claude plugin validate`.
- Testing a skill: trigger and non-trigger prompts, a baseline without the skill, and `claude plugin eval`.

## How to approach it, step by step

1. Sort the lines of the wiki prompt: steps the model can follow, checks it cannot do without a tool, actions it must not take on its own, and noise (shouting, role play).
2. Write the description first: what the skill does, when to use it in the words people actually type, and the near misses it must ignore.
3. Write the steps as checks, each with a status and its evidence, and a final report. Drop tagging and deploying, and turn "assume it is fine" into "report what you could not check".
4. Write the migrations check as a script: a pure function, a CLI with exit codes 0, 1 and 2, and tests.
5. Reference the script through `${CLAUDE_SKILL_DIR}` and pre-approve exactly that command in `allowed-tools`.
6. Package it: the plugin folder with `.claude-plugin/plugin.json` and `skills/`, the marketplace folder with `.claude-plugin/marketplace.json`, then run `claude plugin validate`.
7. Write the trigger cases, try them in fresh sessions with and without the plugin, and automate two of them as `claude plugin eval` cases.

## Solution explained

The plugin lives in [`marketplace/`](./marketplace/.claude-plugin/marketplace.json): the skill is [`SKILL.md`](./marketplace/plugins/release-tools/skills/release-checklist/SKILL.md), its helper is [`check-pending-migrations.mjs`](./marketplace/plugins/release-tools/skills/release-checklist/scripts/check-pending-migrations.mjs), the manifest is [`plugin.json`](./marketplace/plugins/release-tools/.claude-plugin/plugin.json), and the eval cases are in [`evals/`](./marketplace/plugins/release-tools/evals/). [`trigger-cases.md`](./trigger-cases.md) lists the prompts that must and must not trigger it. [`sample-service/`](./sample-service/applied-versions.txt) is a fictional service to run the script on. [`check-pending-migrations.test.ts`](./check-pending-migrations.test.ts) and [`plugin-files.test.ts`](./plugin-files.test.ts) prove what can be proven offline.

```text
marketplace/
├── .claude-plugin/marketplace.json            the catalogue: name, owner, plugins and where they are
└── plugins/release-tools/
    ├── .claude-plugin/plugin.json             the plugin manifest
    ├── evals/<case>/prompt.md, graders/*.md   claude plugin eval cases
    └── skills/release-checklist/
        ├── SKILL.md                           frontmatter (name, description, allowed-tools) + steps
        └── scripts/check-pending-migrations.mjs
```

**Why a skill instead of a pasted prompt.** A skill is a folder with a `SKILL.md` and any files it needs. In a session Claude only sees each skill's name and description; when a request matches the description, it loads the whole `SKILL.md` and follows it (a person can also call it as `/release-tools:release-checklist`). So the checklist applies whenever someone prepares a release, without anyone remembering to paste it; it is versioned and reviewed like code; a plugin delivers the same version to everyone; and it costs context only when it is used.

**The description is the trigger.** It is the only text Claude reads when deciding, so it is written for that decision:

```yaml
description: Checks whether a service is ready to release before a version is tagged or deployed to production. Covers pending database migrations (with a bundled script), changes since the last release, changelog, CI, feature flags and the rollback plan, and ends with a ready or blocking report. Use when the user is preparing, cutting, tagging or shipping a release, or asks if a branch or version can go to production. Do not use for writing release notes alone, explaining versioning, deploying to development or preview environments, or setting up a new project.
```

The key use case comes first, because the listing truncates `description` plus `when_to_use` at 1,536 characters. "Use when" lists the verbs people type (preparing, cutting, tagging, shipping, "can it go to production"); "Do not use for" names the near misses that share words with it (release notes, versioning questions, preview deploys). A trap: in YAML, an unquoted value cannot contain a colon followed by a space, so the description avoids one (a test checks it). Field names must match exactly: Claude Code silently ignores a field it does not recognise, so `allowed_tools` instead of `allowed-tools` grants nothing.

**Steps that end in evidence.** "Check that there are no pending migrations. VERY IMPORTANT!!!" asks for something the model cannot see, and capitals do not give it access to production: it either asks or makes the answer up, and "assume it is fine" tells it to make it up. The skill gives every item a status (**ready**, **blocking**, **needs a decision**) and its evidence, says never to call an item ready without evidence, tells it what each exit code of the script means, and ends with a table. Tagging, pushing and deploying are not steps: the skill reports and a person acts. The role play ("20 years of experience, you never make mistakes") is gone; precise criteria do the work.

**A script for what must be exact.** Comparing a migrations folder with what production applied is string handling, not judgement, so it is code. [`findPendingMigrations(files, appliedVersions)`](./marketplace/plugins/release-tools/skills/release-checklist/scripts/check-pending-migrations.mjs) is pure: it takes dbmate-style file names (`20261121101500_add_customer_tax_id.sql`) and the applied versions (the output of `SELECT version FROM schema_migrations`), returns the pending ones oldest first, compares versions as numbers, and flags a pending migration older than the newest applied one as out of order: tools differ in what they do with it, and it was written against an older schema. The CLI prints the list and exits 0 (nothing pending), 1 (pending, listed) or 2 (it could not run), so the skill can branch on the result. On the sample service:

```text
$ node …/check-pending-migrations.mjs --dir sample-service/db/migrations --applied sample-service/applied-versions.txt
2 pending migration(s) in sample-service/db/migrations, not applied in the target environment:
  20261105120000_add_invoice_due_date.sql  (OUT OF ORDER: older than the newest applied migration)
  20261121101500_add_customer_tax_id.sql
```

It has no dependencies, because a plugin is copied to each machine as files with no install step; `// @ts-check` with JSDoc types, plus `allowJs` and `checkJs` in this kata's `tsconfig.app.json`, keeps it type-checked by `npm run check`.

**Paths and permissions.** `${CLAUDE_SKILL_DIR}` is the skill's own folder wherever the plugin is installed, so `node ${CLAUDE_SKILL_DIR}/scripts/check-pending-migrations.mjs` works in any project. Claude Code substitutes it in the skill's text and in the Bash rules of `allowed-tools`, which lists the tools Claude may use without asking during the turn that invoked the skill. The list holds only the script and two read-only git commands; `git tag`, `git push` or a deploy would still ask for permission.

**Packaging and installing.** `plugin.json` needs a kebab-case `name`; `version`, `description`, `author` and `keywords` describe it. A skill in `skills/<name>/SKILL.md` becomes `/release-tools:release-checklist`, namespaced so it never clashes with a personal or project skill of the same name. `marketplace.json` names the catalogue and its `owner`, and lists each plugin with a `source` relative to the marketplace folder. To install it from the `applied-ai` folder:

```text
/plugin marketplace add ./src/exercises/claude-code-skill-plugin/marketplace
/plugin install release-tools@katas-internal-tools
```

or from a shell, `claude plugin marketplace add …` and `claude plugin install release-tools@katas-internal-tools`. A company marketplace is usually a Git repository (`/plugin marketplace add owner/repo`), so a change to the checklist is a reviewed pull request that reaches everyone on update.

**Validation.** `claude plugin validate --strict marketplace` and `claude plugin validate --strict marketplace/plugins/release-tools` both pass with Claude Code 2.1.330; the plugin check reports that it provides `skills: release-tools:release-checklist`. Without the marketplace `description`, it warned. With `--profile directory` it also applies the checks of Anthropic's public plugin directory (a licence and an icon are required there), which an internal marketplace does not need.

**Testing a skill.** Two separate questions: does Claude use the skill on the prompts it should, and only those; and when it does, is the result right. [`trigger-cases.md`](./trigger-cases.md) lists prompts that must trigger, prompts that must not (the near misses from the description) and border cases, each with the reason. Run them in a fresh session (context left over from writing the skill hides gaps in it), once with `claude --plugin-dir …/release-tools` and once without, and compare. `claude plugin eval` automates that comparison: each folder in `evals/` has a `prompt.md` with limits in its frontmatter and graders in `graders/`: a `tool_used` grader on the Skill tool, with `min: 0`, `max: 0` and `arm: both` for "must not trigger", and an `llm` grader with a rubric for the answer. It runs every case with and without the plugin and reports the difference. Those runs call the model and cost money, so they stay out of `npm test`.

**How it is proven.** `check-pending-migrations.test.ts` covers the pure function (ordering, ignored files and lines, out of order, numeric comparison), the printed report, and the CLI's exit codes on the sample service and on bad arguments. `plugin-files.test.ts` parses the `SKILL.md` frontmatter (name, description length and clauses, YAML safety, `allowed-tools`), checks that the script the body runs exists, validates both manifests with zod, checks the eval cases, and shows that the wiki prompt has no frontmatter and tells the model to tag and deploy. `claude plugin validate` is the external validator. Whether Claude actually triggers the skill is measured with the eval cases, not with unit tests.

## Common mistakes

| Symptom                                                   | Cause                                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The skill never triggers                                  | A vague description ("Release helper"), one written about the implementation, or the key use case at the end.     |
| It triggers on anything that mentions a release           | No exclusions: the near misses are not named in the description.                                                  |
| A frontmatter field has no effect                         | Its name is misspelled (`allowed_tools`); unknown fields are ignored without an error.                            |
| The frontmatter fails to parse or the description is cut  | An unquoted value with a colon followed by a space.                                                               |
| "Script not found" once the plugin is installed           | A path relative to the repository instead of `${CLAUDE_SKILL_DIR}`.                                               |
| A permission prompt every time the script runs            | No `allowed-tools` rule, or one that does not match the command exactly as the steps write it.                    |
| "No pending migrations" with nothing to back it up        | The check is left to the model instead of a script, and no rule requires evidence.                                |
| The plugin installs but the skill is missing              | `SKILL.md` not in `skills/<name>/`, or a wrong `source` in `marketplace.json`: `claude plugin validate` shows it. |
| The skill works when you test it and fails for colleagues | Tested in the session where it was written, where the conversation filled in what the skill does not say.         |

## Practice

Add `scripts/check-changelog.mjs`, which exits 1 when `CHANGELOG.md` has no heading for the given version, use it in step 4 with its own `allowed-tools` rule and tests, and add an eval case for the hotfix border prompt from `trigger-cases.md`.
