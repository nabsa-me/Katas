# Runbook: Jira ingestion stale

For whoever is on call, including someone who has never seen this job. Follow the steps in order; each one says what to look at and what decides the next step. The AWS commands are examples with placeholder names (`<cluster>`, `jira-ingest/…`): adapt them to the real resources. Nothing in this kata runs them.

## When to use it

- The alarm `IngestionLagMinutes` above 26 hours, or `IngestionSucceeded` missing for 26 hours.
- A user reports that dashboards are missing recent Jira changes.
- A run of `jira-ingest` lasted under 10 seconds or ingested 0 issues on a weekday.

## Severity

- **SEV-2** if a report or decision depends on the data within the next 24 hours, or the lag is above 48 hours.
- **SEV-3** otherwise. Raise it if the cause is not found within 30 minutes.

## Before you start

- Access you need: read the job's logs, run the job's task, read the database (read-only is enough to diagnose), write the secret `jira-ingest/jira-api-token`. For a new Jira token, a Jira administrator of the integration account.
- Never paste tokens, connection strings or customer data in a chat or a ticket. Secrets go from the source straight into Secrets Manager.
- Open the incident channel and use the [communication templates](./communication-templates.md) from the first message.

## 1. Confirm and measure the lag (5 minutes)

How old is the newest data?

```sql
SELECT max(updated_at) AS newest, now() - max(updated_at) AS lag FROM issues;
```

To try it on this kata's Postgres (whose fictional data stops on 2026-10-28, so it is always "stale"): `docker compose exec -T postgres psql -U postgres -d production_health -c "SELECT max(updated_at) AS newest, now() - max(updated_at) AS lag FROM issues"`.

A lag of a few hours at night is normal (the job runs at 02:00 UTC). More than 26 hours means at least one run is missing or empty. Note the newest timestamp: it is the start of the impact window.

## 2. Communicate (within 15 minutes)

Declare the incident with its severity, post the notice to users (dashboard banner, support channel) and, for SEV-2, send the first message to management. Impact first; "cause not yet known" is fine. Set the next update time.

## 3. Find which runs failed and how

The scheduler's "succeeded" only means the container exited 0. Look at what the runs did:

```bash
aws scheduler get-schedule --name jira-ingest-nightly --query '{state: State, expression: ScheduleExpression}'
aws logs tail /ecs/jira-ingest --since 3d --format short
```

| What you see                                                       | Most likely cause                                    | Go to |
| ------------------------------------------------------------------ | ---------------------------------------------------- | ----- |
| The schedule is `DISABLED`, or no run started                      | Scheduler disabled, or the task cannot start         | 4.1   |
| Runs ended with a non-zero exit code and an error in the logs      | Read the error: authentication, rate limit, database | 4.x   |
| Runs "succeeded" in a few seconds and logged nothing (or 0 issues) | Errors swallowed by the job; usually authentication  | 3.1   |
| Runs took much longer than usual and ended in a timeout            | Jira slow or rate limiting, or the database          | 4.3   |

### 3.1 Test the job's Jira credentials directly

With the credentials the job uses, read from Secrets Manager into variables (never typed or pasted):

```bash
JIRA_EMAIL=$(aws secretsmanager get-secret-value --secret-id jira-ingest/jira-email --query SecretString --output text)
JIRA_API_TOKEN=$(aws secretsmanager get-secret-value --secret-id jira-ingest/jira-api-token --query SecretString --output text)
curl -s -o /dev/null -w '%{http_code}\n' -u "$JIRA_EMAIL:$JIRA_API_TOKEN" https://your-site.atlassian.net/rest/api/3/myself
unset JIRA_API_TOKEN
```

| Status | Meaning                                                          | Go to |
| ------ | ---------------------------------------------------------------- | ----- |
| 200    | Credentials are fine; look at the query, the data or the job     | 4.4   |
| 401    | Token expired or revoked                                         | 4.2   |
| 403    | The account lost access (permissions, licence, project)          | 4.2   |
| 429    | Rate limited; note `Retry-After` and the `X-RateLimit-*` headers | 4.3   |
| 5xx    | Jira is having problems; check Atlassian's status page for Jira  | 4.3   |

## 4. Fix

### 4.1 The job did not start

Re-enable the schedule if it was disabled on purpose and that reason is gone. If the task fails to start, the stopped task's reason says why (image not found, secret not found, no capacity); fix that, then go to step 5.

### 4.2 Credentials (401, 403)

1. Ask a Jira administrator to create a new API token for the **integration account** (never a person's account), with an expiry date.
2. Store it as a new version of the secret, from a file that you delete afterwards:
   ```bash
   aws secretsmanager put-secret-value --secret-id jira-ingest/jira-api-token --secret-string file://token.txt
   rm token.txt
   ```
3. Repeat the check in 3.1: it must answer 200.
4. Update the credentials inventory with the new expiry date and make sure the expiry alarm points to the team channel.
5. For a 403, the account itself needs its project permissions or licence back; the token is not the problem.

### 4.3 Jira slow, failing or rate limiting

Do not hammer it: one manual run after Jira recovers or after the `Retry-After` time. If rate limits are frequent, the job must back off and honour `Retry-After` (see the api-integrations katas). Communicate the expected recovery time; this is the case where the next update may honestly be "waiting for Jira".

### 4.4 Credentials work but nothing arrives

Run the job by hand with `LOG_LEVEL=debug` and read every line. If it prints nothing about the Jira call, the job is swallowing errors: escalate to the owning team, because a fix in the code is needed. Check the watermark too: a watermark in the future makes every run fetch nothing.

```sql
SELECT * FROM ingestion_watermarks WHERE source = 'jira';
```

## 5. Backfill

If the failed runs did not advance the watermark (the job only saves it after a successful run), one run fetches everything missed. Start it the same way the scheduler does:

```bash
aws ecs run-task --cluster <cluster> --task-definition jira-ingest --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[<subnet-id>],securityGroups=[<security-group-id>]}'
```

If the watermark advanced past the gap, move it back to the last good run minus one hour before running. The overlap is safe because the job upserts by issue key:

```sql
UPDATE ingestion_watermarks SET last_success_at = '<last good run>'::timestamptz - interval '1 hour' WHERE source = 'jira';
```

## 6. Verify (do not skip)

1. The lag query from step 1 shows minutes, not hours.
2. Counts per team for the gap match a Jira search over the same period (`updated >= "<start of the gap>"` in Jira, the same filter in SQL).
3. The examples users reported (the issues they closed) are there.
4. The dashboards show the new "data as of" time.

Then remove the banner and send the "resolved" message.

## 7. Close

- Keep the incident open until the next scheduled run succeeds on its own, and check freshness the morning after.
- SEV-2 or above: schedule a blameless postmortem within three working days (see [`postmortem.md`](./postmortem.md) for the format).
- Update this runbook with anything that was missing or wrong.

## Escalation

| When                                                      | Who                                         |
| --------------------------------------------------------- | ------------------------------------------- |
| A new token or account permissions are needed             | Jira administrators                         |
| The job needs a code change (errors swallowed, bad query) | The platform team that owns `jira-ingest`   |
| Database errors or lag in Postgres                        | Database on-call                            |
| No cause after 30 minutes, or a deadline is at risk       | Platform team lead (and raise the severity) |

## Why freshness is not part of the service's readiness

It is tempting to make the issues service's `/readyz` fail when the data is stale. Don't: readiness decides whether an instance receives traffic, and stale data is the same on every instance, so every instance would leave the load balancer at once and stale dashboards would become no dashboards. Freshness has its own alarm (`IngestionLagMinutes`) and its own visible signal (the "data as of" time on the dashboards).
