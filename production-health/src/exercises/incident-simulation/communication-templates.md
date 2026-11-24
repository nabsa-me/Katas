# Communication templates

Templates for every message of an incident, each followed by the version sent during the [scenario](./scenario.md). Copy them into the incident tool or the chat as they are and fill in the `<…>`.

## Rules for every message

- **Send the first one early.** Within 15 minutes of declaring the incident, before the cause is known. Silence is read as "they don't know" or "they haven't noticed".
- **Impact before cause.** Say what is wrong for whom, what still works, and what decisions are affected. The technical cause comes later and in one sentence.
- **Say what you don't know.** "Cause not yet known" is a fact; a guess presented as a cause has to be retracted later.
- **Always give the time of the next update, and keep it,** even when there is nothing new ("still investigating, next update at 11:00").
- **One channel, one voice.** The incident commander or the communications lead sends the messages; everyone else links to them.
- **No names, no blame, no secrets.** Systems and steps, never people. Never paste tokens, connection strings or customer data.

## Severity and who hears about it

| Severity | Definition                                                                         | Who is told                                  | Update cadence                   |
| -------- | ---------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------- |
| SEV-1    | Customers cannot use the product, or data is lost or exposed                       | Management and support at once; customers    | Every 30 minutes                 |
| SEV-2    | A feature is degraded, or data used for decisions is wrong; a workaround may exist | Management within 30 minutes; affected teams | Every hour, and before deadlines |
| SEV-3    | Internal impact only, no decision depends on it                                    | The owning team's channel                    | When something changes           |

## 1. Incident declared (internal, incident channel)

```text
INCIDENT DECLARED — SEV-<n> — <short title>
Impact: <who is affected and how; what still works>
Started: <first known bad time, or "unknown yet">
Incident commander: <role or rota name> · Comms: <role> · Ops: <role>
Working doc: <link> · Next update: <time>
```

Sent at 09:55:

```text
INCIDENT DECLARED — SEV-2 — Team dashboards show stale Jira data
Impact: dashboards and the issues API serve data as of Saturday 01:57 UTC. The 12:00 management report uses the same data. The issues API itself is up and fast.
Started: probably Sunday 02:00 UTC (last two nightly ingestion runs ingested nothing)
Incident commander: platform on-call · Comms: product team lead · Ops: platform on-call
Working doc: <link> · Next update: 10:30 UTC
```

## 2. First message to management

Business language, no jargon, three short paragraphs at most.

```text
Subject: [SEV-<n>] <what is affected, in business terms> — investigating

What is happening: <the effect, in one or two sentences>.
What it affects: <decisions, reports, customers>. What is not affected: <…>.
What we are doing: <the current step>. Cause: <known in one sentence / not known yet>.
Next update: <time>, or sooner if anything changes.
```

Sent at 10:02:

```text
Subject: [SEV-2] Team dashboards show data from Saturday morning — investigating

What is happening: the team dashboards have not received Jira updates since Saturday morning, so issues closed since then do not appear.
What it affects: today's 12:00 management report uses these numbers and is at risk; this morning's sprint reviews may have used incomplete figures. Jira itself, and the issues it holds, are not affected; no data is lost.
What we are doing: we are checking the nightly job that copies data from Jira. Cause not yet known.
Next update: 10:30 UTC, or sooner if anything changes.
```

## 3. Update

```text
Subject: [SEV-<n>] <title> — update <n> (<investigating / fix in progress / monitoring>)

Since the last update: <what was found or done>.
Current state: <impact now>. Expected: <next milestone and when, with the uncertainty stated>.
Next update: <time>.
```

Sent at 10:30:

```text
Subject: [SEV-2] Team dashboards show data from Saturday morning — update 1 (fix in progress)

Since the last update: we found the cause. The account the nightly job uses to read Jira lost its access on Saturday night, and the job did not report the failure. Access is restored.
Current state: the missing data is being reloaded now; this takes a few minutes.
Expected: the 12:00 report on time with correct data; if the reload needs checking for longer, at most one hour late. We will confirm by 11:15.
Next update: 11:15 UTC.
```

## 4. Resolved

```text
Subject: [SEV-<n>] <title> — resolved

Resolved at <time>. Impact: <what was affected, from when to when>.
Cause in one sentence: <…>.
What we did: <fix and verification>. What we are doing next: <monitoring, follow-ups>.
Postmortem: <date>; the summary will be shared by <date>.
```

Sent at 11:15:

```text
Subject: [SEV-2] Team dashboards show data from Saturday morning — resolved

Resolved at 10:41 UTC. Impact: from Sunday 02:00 to Monday 10:41 UTC the dashboards were missing every Jira update made since Saturday morning. No data was lost, and the 12:00 report uses complete data.
Cause in one sentence: the nightly copy from Jira lost its access when a credential expired, and the job reported success instead of failing.
What we did: renewed the credential, reloaded the missing data and checked the totals against Jira. Tonight's run is monitored, and we check the data again tomorrow at 09:00.
Postmortem: Wednesday; the summary will be shared by Thursday.
```

## 5. Notice to affected users

Where the users of the affected thing will see it: a banner on the dashboard, the support channel, the status page.

```text
<Name of the feature> is showing <the problem> since <time>. <Workaround, if any>. We are working on it; next update at <time> in <link>.
```

Posted at 10:05 in the support channel and as a dashboard banner:

```text
The team dashboards are showing Jira data from Saturday 01:57 UTC; issues closed since then are missing. For today's numbers, use the Jira board directly. We are working on it; next update at 10:30 UTC in this channel.
```

## 6. Postmortem announcement

```text
Postmortem for SEV-<n> "<title>" (<date>): <link>.
Summary: <two sentences: what happened and the main lesson>.
Action items: <number>, tracked in <link>. Questions and corrections welcome in the document's comments.
```
