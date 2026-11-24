-- Least-privilege roles for one application database. Run once, connected to that database as the RDS
-- master user (locally: postgres). Group roles hold the privileges and cannot log in; each workload logs
-- in with its own user, which inherits from exactly one group.
-- No passwords here: they live in Secrets Manager (rotated), or the user authenticates with IAM
-- (GRANT rds_iam TO issues_api).

-- Group roles.
CREATE ROLE migrator NOLOGIN; -- owns the schemas and every table: the only role that runs DDL
CREATE ROLE app_rw NOLOGIN; -- the application: reads and writes rows, never changes the schema
CREATE ROLE app_ro NOLOGIN; -- read-only consumers: support tools, read replicas
CREATE ROLE reporting NOLOGIN; -- BI tools: only the views in the reports schema

-- Login users, one per workload.
CREATE ROLE deployer LOGIN IN ROLE migrator; -- CI/CD, runs the migrations
CREATE ROLE issues_api LOGIN IN ROLE app_rw;
CREATE ROLE issues_viewer LOGIN IN ROLE app_ro;
CREATE ROLE bi_reader LOGIN IN ROLE reporting;

-- Objects deployer creates must belong to migrator, not to deployer, so the default privileges below
-- apply to them: every deployer session starts as migrator.
ALTER ROLE deployer SET role = 'migrator';

-- On RDS the master user is not a superuser: it needs membership to hand ownership to migrator.
GRANT migrator TO CURRENT_USER;

-- Nobody connects by default (PUBLIC has CONNECT and TEMPORARY on every new database).
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO migrator, app_rw, app_ro, reporting', current_database());
END
$$;

-- Nobody creates objects in public but its owner (Postgres 15+ already revokes CREATE from PUBLIC on new
-- databases; databases upgraded from older versions still have it).
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO migrator;
GRANT USAGE ON SCHEMA public TO app_rw, app_ro;

CREATE SCHEMA reports AUTHORIZATION migrator;
GRANT USAGE ON SCHEMA reports TO reporting;

-- Privileges on the objects migrator creates from now on. GRANT … ON ALL TABLES only covers the tables
-- that already exist; without these, every new table would be invisible to the application.
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
-- Sequences behind serial columns (identity columns need no grant of their own).
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
GRANT SELECT ON TABLES TO app_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA reports
GRANT SELECT ON TABLES TO reporting;
-- New functions are executable by PUBLIC unless revoked.
ALTER DEFAULT PRIVILEGES FOR ROLE migrator
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
