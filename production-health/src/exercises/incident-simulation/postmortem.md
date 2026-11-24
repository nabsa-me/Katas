# Postmortem: stale team dashboards after the Jira ingestion failed silently

Blameless: this document describes systems, decisions and conditions, not people. Everyone involved acted reasonably with the information and tools they had; the goal is to change the system so the same conditions cannot produce the same result.

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Severity        | SEV-2 (data used for decisions was wrong; no data lost; product available)                       |
| Date            | Sunday 2026-11-15 02:00 to Monday 2026-11-16 10:41 UTC                                           |
| Detected by     | A user (a team lead), not by monitoring                                                          |
| Time to detect  | 31 h 40 min                                                                                      |
| Time to resolve | 61 min after detection                                                                           |
| Status          | Resolved; action items tracked below                                                             |
| Meeting         | Wednesday 2026-11-18, with the platform team, the product team lead and the job's previous owner |

## Summary

The nightly job that copies Jira issues into the database behind the team dashboards failed for two nights in a row because the API token it uses had expired. The job caught the `401 Unauthorized` error, discarded it and exited with code 0, so the scheduler recorded both runs as successful and no alarm fired. The dashboards kept serving Saturday morning's data until a team lead noticed on Monday at 09:40. The token was renewed, the missing data reloaded and verified by 10:41, and the 12:00 management report used correct data.

## Impact

- The team dashboards and the issues API missed every Jira update made after Saturday 01:57 UTC, for 32 h 41 min.
- One sprint review on Monday at 10:00 used incomplete numbers (eleven issues closed that morning were missing). Its throughput figures were corrected and re-sent the same day.
- The 12:00 management report was at risk until the data was verified at 10:41, and went out on time with correct data.
- No data was lost: Jira is the source of truth, and the watermark of the job had not advanced, so one run recovered everything.
- No customer-facing impact.

## Timeline (UTC)

| Time      | Event                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------- |
| Sat 02:00 | Last successful run; data complete up to 01:57.                                                           |
| Sat 23:00 | The integration account's API token expires.                                                              |
| Sun 02:00 | Run fails with 401; the error is swallowed; exit code 0; the scheduler shows success.                     |
| Mon 02:00 | Same.                                                                                                     |
| Mon 09:40 | A team lead reports the dashboard shows nothing closed since Saturday. **Detection.**                     |
| Mon 09:46 | The platform on-call engineer acknowledges.                                                               |
| Mon 09:52 | `max(updated_at)` is Saturday 01:57; the last two runs lasted under 2 s instead of 40–90 s.               |
| Mon 09:55 | SEV-2 declared; incident channel opened; roles assigned.                                                  |
| Mon 10:02 | First message to management.                                                                              |
| Mon 10:05 | Notice posted to users; job logs show nothing; a manual run with debug logging shows nothing either.      |
| Mon 10:12 | A direct call to Jira's `GET /rest/api/3/myself` with the job's credentials returns 401. **Cause found.** |
| Mon 10:20 | New token created and stored as a new Secrets Manager version.                                            |
| Mon 10:30 | Update to management.                                                                                     |
| Mon 10:33 | Manual backfill run: 168 issues, 52 s.                                                                    |
| Mon 10:41 | Data verified against Jira. **Resolved.**                                                                 |
| Mon 11:15 | Resolution message to management.                                                                         |
| Tue 02:00 | Scheduled run succeeds; Tue 09:00 manual check confirms fresh data; incident closed.                      |

## What went wrong, and why

The question is not "who let the token expire" but "why could a token expire, and a job fail for two nights, without the system telling anyone".

**1. The job reported success when it had done nothing.** Its main loop wraps the work in `try { … } catch {}` and always ends with `process.exit(0)`. The comment explains the intent: "Jira is sometimes flaky at night; the next run will catch up". Retrying transient failures is reasonable; treating every failure, including a permanent one like a revoked credential, as transient is not. With no log line and a zero exit code, the failure was invisible at every level: logs, exit code, scheduler, alarms.

**2. Monitoring watched the job, not the data.** The only alarm was "task failed", based on the exit code. Nothing measured what users care about: how old the newest data is. A run that ingests nothing and exits 0 is indistinguishable from a quiet night. The run duration (under 2 seconds instead of 40–90) was a clear signal, recorded and never alarmed on.

**3. The credential belonged to a person's workflow.** The token had an expiry date, which is good practice. But its expiry reminders went to the personal mailbox of the engineer who created it, who had since moved to another team. No inventory of integration credentials and their expiry dates existed, and no alarm was tied to the expiry.

**4. The healthy service hid the problem.** The issues service was fast and correct about what it had: `/readyz` green, p95 6 ms, 0 % errors. Its alarms worked as designed; they were not designed to answer "is the data fresh?" This is the right design for readiness (see "What went well"), but it means freshness needs its own signal.

**5. A weekend lowered the chance of noticing.** Few updates happen on Saturday and Sunday, so stale data looked plausible until Monday morning's work did not appear.

Five whys, on the main thread:

1. Why were the dashboards stale? The job had not ingested anything since Saturday.
2. Why had it not ingested? Jira rejected its credentials (401) after the token expired.
3. Why did nobody know for 31 hours? The job swallowed the error and exited 0, and the only alarm was on the exit code.
4. Why was the error swallowed? A broad `catch {}` was added to tolerate occasional night-time failures, with no distinction between transient and permanent errors.
5. Why did no one catch this before? There was no freshness objective for the data, so no test, review or alarm asked "what if the job succeeds and nothing arrives?"

## What went well

- Once reported, the issue was triaged quickly: freshness was checked first (6 minutes), which pointed straight at ingestion.
- Management heard about it 22 minutes after the first report, with impact in business terms and a next-update time, and every promised update was sent on time.
- The token was never pasted into chat; it went straight into Secrets Manager.
- The watermark design meant no data was lost and one run recovered everything; the backfill was verified against Jira, not assumed.
- The issues service's readiness check did not include data freshness. Had it, every instance would have been taken out of the load balancer on Sunday, turning stale dashboards into no dashboards.

## Where we got lucky

- It was found on Monday at 09:40, more than two hours before the management report. On a Monday with an 08:00 report, the leadership meeting would have used wrong numbers.
- Only one credential expired. Two other integrations set up in the same week have tokens expiring in the next 30 days (found during this review).

## Action items

| Action                                                                                                                                             | Type     | Owner (role)       | Priority | Due        |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------ | -------- | ---------- |
| Remove the `catch {}`: classify errors (401/403 permanent, 429/5xx/timeouts retried with backoff), log every failure with its cause, exit non-zero | Prevent  | Platform team      | P1       | 2026-11-20 |
| Freshness metric `IngestionLagMinutes` (now minus newest `updated_at`) and an alarm above 26 h, treating missing data as breaching                 | Detect   | Platform team      | P1       | 2026-11-20 |
| Heartbeat: the job emits `IngestionSucceeded` only after its data checks pass; alarm when absent for 26 h                                          | Detect   | Platform team      | P1       | 2026-11-20 |
| Alarm on a run that lasts under 10 s or ingests 0 issues on a weekday                                                                              | Detect   | Platform team      | P2       | 2026-11-27 |
| Inventory of integration credentials with owner team, expiry date and rotation steps; alarm 30 days before each expiry, sent to the team channel   | Prevent  | Platform team lead | P1       | 2026-11-27 |
| Rotate the two tokens expiring in the next 30 days                                                                                                 | Prevent  | Platform on-call   | P1       | 2026-11-19 |
| "Data as of <time>" on every dashboard, in a warning colour when older than 26 h                                                                   | Mitigate | Product team       | P2       | 2026-12-04 |
| Publish the runbook "Jira ingestion stale" and link it from the new alarms                                                                         | Mitigate | Incident commander | P1       | 2026-11-20 |
| Add a test that the job exits non-zero when Jira answers 401                                                                                       | Prevent  | Platform team      | P1       | 2026-11-20 |

Types: **prevent** stops the cause, **detect** shortens the time to notice, **mitigate** reduces the impact when it happens anyway. This incident's cost was almost entirely detection time (31 h 40 min against 61 min to resolve), so detection carries most of the weight.

## Lessons

- **A job that cannot fail cannot be monitored.** Exit codes, logs and alarms only work if failures reach them.
- **Monitor the outcome users depend on.** For a pipeline, that is freshness and completeness of the data, not whether a container exited 0.
- **Silence must be an alert.** Alarms that treat missing data as fine are blind to the thing that stopped; heartbeats and freshness alarms treat silence as breaching.
- **Credentials need owners that outlive people:** a team, an inventory, and an alarm before expiry.
