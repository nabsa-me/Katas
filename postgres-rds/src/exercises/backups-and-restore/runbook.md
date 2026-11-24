# Runbook: backups and restore of the issues database (RDS for PostgreSQL)

Use it before a risky change, after data loss or corruption, and every quarter for a restore drill. The AWS CLI commands are commented out on purpose: read them, replace the identifiers, then run them one at a time.

Identifiers used below (fictional): instance `issues-prod`, region `eu-west-1`, subnet group `issues-db-subnets`, security group `sg-0123example`, parameter group `issues-postgres16`.

## Targets

- **RPO (recovery point objective)**: how much data, measured in time, the business accepts losing. With automated backups and point-in-time recovery it is about 5 minutes: RDS uploads the transaction logs every 5 minutes, so the latest restorable time trails the present by about that much.
- **RTO (recovery time objective)**: how long the service may be down until it is back on restored data. It is the time to create the new instance, plus replaying logs, plus verification and cutover. Only a drill measures it; write the measured time here after each one.

| Target | Agreed   | Last measured (drill date) |
| ------ | -------- | -------------------------- |
| RPO    | 5 min    | (fill in)                  |
| RTO    | (agreed) | (fill in)                  |

## What must be in place

- [ ] Automated backups with a retention of at least 7 days (allowed: 0–35; 0 disables backups and point-in-time recovery; the CLI's default is 1 day, the console's 7).
- [ ] Deletion protection on the production instance.
- [ ] A manual snapshot before every risky change (below). Manual snapshots are kept until someone deletes them.
- [ ] A restore drill in the last quarter, with its RTO written above.

```bash
# Check retention and the latest restorable time:
# aws rds describe-db-instances --db-instance-identifier issues-prod \
#   --query 'DBInstances[0].[BackupRetentionPeriod,LatestRestorableTime]'

# Raise retention to 14 days:
# aws rds modify-db-instance --db-instance-identifier issues-prod \
#   --backup-retention-period 14 --apply-immediately
```

## Before a risky migration

Risky: anything that drops or rewrites data (a contract step that drops a column, a backfill that overwrites values, a bulk delete).

1. Announce the change window and the rollback plan.
2. Take a manual snapshot named after the change, and wait for it:

   ```bash
   # aws rds create-db-snapshot --db-instance-identifier issues-prod \
   #   --db-snapshot-identifier issues-prod-before-drop-full-name
   # aws rds wait db-snapshot-available --db-snapshot-identifier issues-prod-before-drop-full-name
   ```

   On a Single-AZ instance the snapshot suspends I/O briefly (seconds to a few minutes); on Multi-AZ it is taken from the standby. Data in unlogged tables might not be restored from a snapshot.

3. Write the snapshot identifier in the change ticket.
4. Run the migration. If it goes wrong, restore from that snapshot (below) instead of improvising a fix in production.

## Restore to a point in time (bad data, accidental delete)

1. Find the moment just before the incident (application logs, the time of the bad deploy, the first wrong row), in UTC.
2. Check it is restorable: it must be after the earliest backup and before `LatestRestorableTime`.
3. Restore to a **new** instance. A restore never overwrites the existing one. Pass the network and parameter settings explicitly: otherwise the new instance gets the default security group, subnet group and parameter group, and is single-AZ.

   ```bash
   # aws rds restore-db-instance-to-point-in-time \
   #   --source-db-instance-identifier issues-prod \
   #   --target-db-instance-identifier issues-pitr-20261124 \
   #   --restore-time 2026-11-24T09:55:00Z \
   #   --db-subnet-group-name issues-db-subnets \
   #   --vpc-security-group-ids sg-0123example \
   #   --db-parameter-group-name issues-postgres16 \
   #   --multi-az --deletion-protection
   # aws rds wait db-instance-available --db-instance-identifier issues-pitr-20261124
   ```

   `--use-latest-restorable-time` instead of `--restore-time` restores as close to now as possible.

4. Decide between:
   - **Repair**: only some rows were lost. Copy them from the restored instance into production (`pg_dump --table` or `\copy`), and keep production running.
   - **Cutover**: production is unusable. Switch the application to the restored instance (next section).

## Restore from a snapshot (failed migration)

```bash
# aws rds restore-db-instance-from-db-snapshot \
#   --db-instance-identifier issues-restored-20261124 \
#   --db-snapshot-identifier issues-prod-before-drop-full-name \
#   --db-subnet-group-name issues-db-subnets \
#   --vpc-security-group-ids sg-0123example \
#   --db-parameter-group-name issues-postgres16 \
#   --multi-az --deletion-protection
# aws rds wait db-instance-available --db-instance-identifier issues-restored-20261124
```

Data written after the snapshot is not in it. If the application kept writing after the migration, restore to a point in time instead, or repair from the old instance.

## After restoring: verify, cut over, clean up

1. **Verify** on the restored instance before any traffic reaches it: row counts of the main tables against the last known numbers, the newest `updated_at` against the expected restore time, `dbmate status` against the expected migration, and the application's smoke test pointed at it.
2. **Cut over**, one of:
   - Point the application at the new endpoint (update the secret or configuration it reads, then restart or redeploy).
   - Keep the endpoint name: rename the old instance, then give the restored one the production identifier. The endpoint hostname follows the identifier, and each rename reboots that instance.

     ```bash
     # aws rds modify-db-instance --db-instance-identifier issues-prod \
     #   --new-db-instance-identifier issues-prod-broken-20261124 --apply-immediately
     # aws rds modify-db-instance --db-instance-identifier issues-restored-20261124 \
     #   --new-db-instance-identifier issues-prod --apply-immediately
     ```

3. Check backups are enabled on the new production instance (retention, deletion protection) and the alarms point at it.
4. Keep the old instance stopped (not deleted) until the incident review is closed, then take a final snapshot and delete it.
5. Write the measured RTO and RPO at the top of this runbook.

## Local drill

`npm run restore-drill` (with `docker compose up -d --wait`) practises the same sequence on the local container: seed a database, `pg_dump --format=custom`, drop the database, create it again, `pg_restore`, and compare the exact row count of every table. It prints the backup and restore times and exits with 1 on any mismatch. See [`README.md`](./README.md).

## Logical backups (`pg_dump`) and snapshots

Snapshots and point-in-time recovery restore the whole instance and are the primary backup on RDS. `pg_dump` is a logical, per-database backup: use it to move data between versions, engines or accounts, to extract one table, or for long-term archives. It does not include roles or their passwords (`pg_dumpall --globals-only`, with `--no-role-passwords` on RDS), and its version must be at least the server's.
