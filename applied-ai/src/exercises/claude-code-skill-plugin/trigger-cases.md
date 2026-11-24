# Trigger cases for the release-checklist skill

Claude decides whether to use a skill from its `description` alone, so the description is tested like code: prompts that must load the skill, prompts that must not, and prompts on the border that show where the line is. Two of them are automated in the plugin's [`evals/`](./marketplace/plugins/release-tools/evals/) folder.

## Should trigger

| Prompt                                                                                                   | Why                                                 |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| We are about to tag version 2.4.0 of the billing service and deploy it to production. Is it ready to go? | Tagging and deploying to production: the core case. |
| Can this branch go to prod today?                                                                        | Asks if a branch can go to production.              |
| I'm cutting the 3.1 release this afternoon, anything I should check first?                               | "Cutting a release" is in the description.          |
| Before I ship 1.8.2, are there migrations that haven't run in production yet?                            | Shipping a release, asked through one of its steps. |
| Run the release checklist for the invoices service.                                                      | Names the skill's job directly.                     |

## Should not trigger

| Prompt                                                                                     | Why                                                   |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| In semantic versioning, when should I bump the minor version instead of the patch version? | Explaining versioning is excluded in the description. |
| Write the release notes for 2.4.0 from these commits.                                      | Release notes alone are excluded.                     |
| Deploy this branch to the preview environment.                                             | Development and preview deployments are excluded.     |
| Create a new migration that adds a `due_date` column.                                      | About migrations, but not about a release.            |
| Set up a new service with CI and a changelog.                                              | New project setup is excluded.                        |

## Border cases (decide, then write the decision into the description)

| Prompt                                     | Expected and why                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Is the hotfix for PLAT-104 safe to deploy? | Trigger: a hotfix is a release to production, and it needs the same checks, the rollback plan above all. |
| What changed since the last release?       | No trigger: one step of the checklist, answered with `git log` alone.                                    |

## How to run them

**By hand.** Start a fresh session with only this plugin loaded, so nothing from earlier work hints at the skill: `claude --plugin-dir src/exercises/claude-code-skill-plugin/marketplace/plugins/release-tools` from the `applied-ai` folder. Type one prompt per session and watch whether Claude calls the Skill tool for `release-tools:release-checklist` before answering. Then run the same prompts without `--plugin-dir`: the difference between the two answers is what the skill adds. `/skill-doctor` lists skills that are never used and what they cost in context.

**Automated.** `claude plugin eval src/exercises/claude-code-skill-plugin/marketplace/plugins/release-tools --no-publish` runs each case in `evals/` three times with the plugin and three times without it, grades the answers and reports the difference. Each case is a folder with a `prompt.md` (the prompt, plus `max_turns`, `timeout_seconds`, `allowed_tools` and `runs` in its frontmatter) and one file per grader in `graders/`: `tool_used` checks whether the Skill tool was called (with `min: 0`, `max: 0` and `arm: both` for "must not trigger"), and `llm` grades the answer against a rubric. These runs call the model and cost money, so they are not part of `npm test`; the tests only check that the case files are well formed.
