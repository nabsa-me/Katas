# Scenario: the Jira ingestion has not run for two days

Fictional. Every name, number and time is made up for the exercise. Times are UTC.

## The system

```text
Jira Cloud ──(nightly, 02:00)──> jira-ingest job ──upsert──> Postgres `issues` ──> issues service ──> team dashboards
                                                                                                └──> Monday report to management
```

- **jira-ingest** is a scheduled container task (EventBridge Scheduler starting an ECS task every night at 02:00). It asks Jira for the issues updated since the last successful run (the watermark), upserts them into the `issues` table, and advances the watermark. It authenticates with the email and API token of an integration account, read from AWS Secrets Manager.
- The **issues service** (the one from the observability exercise) reads that table. It has health checks, structured logs, EMF metrics and alarms on p95 latency and error rate.
- The **team dashboards** show open issues and weekly throughput per team. Every Monday at 12:00 the **management report** takes the same numbers to the leadership meeting.
- **Monitoring of the job:** the scheduler's task status (the container's exit code) and an alarm on "task failed". Nothing watches the data itself.

The job's main loop, as deployed:

```ts
const watermark = await readWatermark();
try {
  const issues = await jira.searchUpdatedSince(watermark);
  await upsertIssues(issues);
  await saveWatermark(startedAt);
} catch {
  // Jira is sometimes flaky at night; the next run will catch up.
}
process.exit(0);
```

## What happened, minute by minute

Only the first part is visible at the start of the exercise. Stop at each **Pause** and decide what you would do before reading on.

### The weekend

| Time (UTC)       | Event                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sat 14 02:00     | Last successful run: it ingests every update up to Saturday 01:57, Friday's work included, and advances the watermark to 02:00.                                                                                           |
| Sat 14 23:00     | The integration account's API token expires. It had been created a year earlier with an expiry date; the reminder emails went to the mailbox of the engineer who created it, who had moved to another team in the summer. |
| Sun 15 02:00     | jira-ingest runs. Jira answers `401 Unauthorized`. The `catch {}` swallows it, the watermark stays at Saturday 02:00, the process exits 0. The scheduler records a successful run. No log line, no alarm.                 |
| Mon 16 02:00     | Same: 401, swallowed, exit 0, "succeeded". Nothing has been ingested for two days.                                                                                                                                        |
| Weekend, all day | The issues service is healthy: `/readyz` is green, p95 is 6 ms, error rate 0 %. It serves Saturday morning's data perfectly.                                                                                              |

### Monday 2026-11-16

| Time (UTC) | Event                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 09:40      | A team lead posts in the support channel: "Throughput dashboard says we closed nothing since Saturday. We closed eleven issues this morning alone. Is something broken?" |
| 09:46      | The platform on-call engineer acknowledges in the channel and starts looking.                                                                                            |

**Pause 1.** It is 09:46. The management report goes out at 12:00. What do you check first, who do you tell, and what do you write? Draft the first internal message and decide whether management needs to hear about it now.

| Time (UTC) | Event                                                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 09:52      | Freshness check: `SELECT max(updated_at) FROM issues` returns Saturday 01:57. The job's last two runs show "succeeded" in the scheduler, each lasting under 2 seconds (a normal run takes 40 to 90 seconds).                    |
| 09:55      | The on-call engineer declares an incident (SEV-2: data used for decisions is wrong, and the 12:00 report depends on it), takes the incident commander role, opens an incident channel and asks the team lead for help on comms. |
| 10:02      | First message to management (see the communication templates): dashboards stale since Saturday morning, the 12:00 report at risk, next update at 10:30.                                                                         |
| 10:05      | The job's logs for the two runs contain only the start line. Running the job by hand with debug logging prints nothing either: the `catch {}` hides the error at every level.                                                   |
| 10:12      | The engineer calls Jira directly with the integration account's credentials (`GET /rest/api/3/myself`): `401 Unauthorized`. Cause identified.                                                                                   |

**Pause 2.** You know the cause. What are the steps to restore the data, in which order, and how do you prove it is restored? What do you tell management at 10:30?

| Time (UTC) | Event                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10:20      | A Jira administrator creates a new API token for the integration account. The engineer stores it in Secrets Manager (a new secret version), never in the incident channel.                              |
| 10:24      | `GET /rest/api/3/myself` with the new token: `200`.                                                                                                                                                     |
| 10:30      | Update to management: cause found and fixed, data being reloaded, report on track for 12:00 or delayed by at most one hour, next update at 11:15.                                                       |
| 10:33      | Backfill: the job runs by hand. The watermark is still Saturday 02:00 (the failed runs never advanced it), so the run fetches everything updated since then: 168 issues in 2 pages, 52 seconds, exit 0. |
| 10:41      | Verification: `max(updated_at)` is 10:39 today; issue counts per team match a Jira search for the same period; the team lead confirms the eleven issues closed this morning appear.                     |
| 10:45      | Dashboards correct. The incident commander keeps the incident open until the scheduled 02:00 run succeeds with the new token, and adds a temporary manual check for Tuesday 09:00.                      |
| 11:15      | Update to management: resolved, the 12:00 report uses correct data, a short summary of the cause, postmortem on Wednesday.                                                                              |
| Tue 02:00  | The scheduled run succeeds: 212 issues, 48 seconds. Tue 09:00 manual check: fresh. Incident closed.                                                                                                     |
| Wed 18     | Blameless postmortem meeting; the postmortem and the runbook are published.                                                                                                                             |

**Pause 3.** Before reading the postmortem: list every reason this took almost 32 hours to notice instead of minutes. Then compare with the contributing factors in [`postmortem.md`](./postmortem.md).

## Facts for the exercise

- Impact window: the dashboards missed every update made after Saturday 01:57. They were stale from the first failed run (Sunday 02:00) until the data was verified (Monday 10:41): 32 hours 41 minutes. Detection took 31 hours 40 minutes (Sunday 02:00 to Monday 09:40); resolution after detection, 61 minutes.
- No data was lost: Jira is the source of truth and the watermark had not advanced.
- One team's sprint review on Monday at 10:00 used Saturday morning's numbers, without the eleven issues closed that morning. The management report went out on time with correct data.
- The issues service never failed: every health check, latency and error-rate alarm stayed green the whole time.
