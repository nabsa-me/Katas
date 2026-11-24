# Incident simulation: a data pipeline that failed silently

## Statement

Monday, 09:40 UTC. A team lead posts in the support channel: the throughput dashboard shows nothing closed since Saturday, although the team closed eleven issues this morning. The nightly job that copies Jira issues into the database behind the dashboards has "succeeded" every night. The issues service that serves the dashboards is healthy: readiness green, p95 6 ms, no errors. The management report that uses the same numbers goes out at 12:00. The job's main loop:

```ts
try {
  const issues = await jira.searchUpdatedSince(watermark);
  await upsertIssues(issues);
  await saveWatermark(startedAt);
} catch {
  // Jira is sometimes flaky at night; the next run will catch up.
}
process.exit(0);
```

Run the incident from the first signal: decide the severity, communicate to management before you know the cause, find the cause, restore and verify the data. Then write the blameless postmortem and the runbook that would have turned this into a ten-minute alert on Sunday night. The full scenario, with pauses for your own decisions, is in [`scenario.md`](./scenario.md).

## What gets assessed

- Running an incident: severity, roles (incident commander, communications), a timeline written as you go.
- Communicating to management early, in business terms, with a next-update time that is kept.
- A blameless postmortem: contributing factors in the system, not culprits; action items that prevent, detect and mitigate.
- A runbook that someone who has never seen the job can follow at 3 a.m.
- Detecting silent failures: alarms on the outcome (data freshness, heartbeats) rather than on exit codes.

## How to approach it, step by step

1. Read [`scenario.md`](./scenario.md) up to **Pause 1**. Before reading on, write down what you check first and draft the first internal message and the first message to management.
2. Measure before guessing: how old is the newest data? That single number gives the impact window and points at the pipeline.
3. Declare the incident, assign roles and send the first messages within 15 minutes, with "cause not yet known" if that is the truth.
4. Find the cause by testing the job's dependencies directly (its Jira credentials), because its own logs say nothing.
5. Fix, backfill and **verify** against the source, then communicate the resolution; keep the incident open until the next scheduled run succeeds.
6. Write the postmortem: timeline, impact, contributing factors (ask "why did the system allow it", five times), what went well, where you got lucky, action items with types, owners and dates.
7. Write the runbook from what you wish you had had at 09:46.

## Solution explained

Four documents: [`scenario.md`](./scenario.md) (the system, the timeline and the pauses), [`communication-templates.md`](./communication-templates.md) (every message, as a template and as sent), [`postmortem.md`](./postmortem.md) (blameless) and [`runbook.md`](./runbook.md) ("Jira ingestion stale").

**A failure designed to be silent.** Three choices, each reasonable alone, add up to an invisible failure: a `catch {}` that treats every error as transient, an unconditional `process.exit(0)`, and an alarm that watches only the exit code. The token expiring is the trigger, not the cause; any permanent error (a revoked permission, a renamed field, a full disk) would have been just as silent. The fix in the code is the one from the observability exercise and the PoC hardening kata: classify errors (permanent ones fail the run, transient ones are retried with backoff), log every failure with its cause, exit non-zero.

**Communicate before you understand.** The first message to management went out 22 minutes after the first report, with no cause: what is wrong, what it affects (the 12:00 report), what is not affected (Jira, no data lost), what is being done, and the next update time. Each later message keeps the same structure and arrives when promised. The templates separate the internal declaration (roles, links), the management messages (business language) and the notice to users (where they will see it, with a workaround).

**Measure the data, not the job.** The fastest diagnostic was `SELECT max(updated_at) FROM issues`: it gave the impact window and pointed straight at ingestion. The postmortem turns that into the main detection actions: a freshness metric with an alarm at 26 hours (one missed run plus margin), a heartbeat emitted only after the run's data checks pass, and alarms on suspicious runs (under 10 seconds, 0 issues on a weekday). All of them treat missing data as breaching, because the failure to detect is the system going quiet.

**Blameless means "why did the system allow it".** The postmortem never asks who let the token expire. It asks why a credential could expire unnoticed (reminders to a personal mailbox, no inventory, no alarm), why a failure could look like success (the `catch {}` and the exit code), and why monitoring missed it (it watched the job, not the data). People who expect blame hide information; people who expect system fixes share it, and the action items get better. The "where we got lucky" section is what keeps the severity honest: with an 08:00 report, leadership would have used wrong numbers.

**Action items have a type, an owner and a date.** Prevent (classify errors, rotate the other expiring tokens, credentials inventory), detect (freshness, heartbeat, suspicious runs) and mitigate ("data as of" on the dashboards, the runbook). Detection took 31 h 40 min and resolution 61 min, so most of the weight is on detection.

**The runbook is a decision path, not a description.** Each step says what to look at and what decides the next step: measure the lag, communicate, find how the runs failed, test the credentials directly, fix by cause, backfill (and when the watermark must be moved back), verify against Jira, close only after the next scheduled run. It also records a design decision that is easy to get wrong under pressure: data freshness does not belong in the service's readiness check, because stale data is the same on every instance and failing readiness would take them all out of rotation at once.

**How it is proven.** By documents, not tests: this exercise produces the artefacts of an incident (timeline, messages, postmortem, runbook), and their content is the deliverable. The only command in them that runs locally is the freshness query in the runbook, which works against this kata's Postgres (`docker compose exec -T postgres psql …`); the AWS and Jira commands are examples with placeholder names and are not executed.

## Common mistakes

| Symptom                                                        | Cause                                                                             |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Management hears about the incident from users                 | Waiting to know the cause before sending the first message.                       |
| Updates stop once the team is busy fixing                      | No next-update time was promised, or no one owns communication.                   |
| The postmortem's main action is "be more careful"              | Asking "who" instead of "why did the system allow it"; no detection actions.      |
| A job "succeeded" for days and did nothing                     | A broad `catch {}`, an unconditional exit 0, and alarms only on exit codes.       |
| A freshness alarm that never fires when the job stops          | Missing data treated as not breaching; silence must alarm.                        |
| The same data goes stale again after the token is renewed      | The data was not backfilled, or the watermark had moved past the gap.             |
| The incident is closed and fails again the next night          | Closed after the manual fix instead of after the next scheduled run succeeded.    |
| Every instance of the service leaves the load balancer at once | Data freshness added to the readiness check.                                      |
| A token appears in the incident channel                        | No safe path for secrets in the runbook; it must go straight to the secret store. |

## Practice

Write the freshness alarm and the heartbeat alarm from the action items as a CDK stack next to [`../node-observability/alarms-stack.ts`](../node-observability/alarms-stack.ts), with `treatMissingData` set to breaching, and test them with `Template.fromStack()` the same way.
