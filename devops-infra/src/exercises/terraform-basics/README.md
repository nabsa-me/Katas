# Terraform basics

## Statement

The application's Postgres databases were created by hand in the AWS console, one per environment. Nobody knows how dev and prod differ, the master password lives in a wiki page, and the last person who changed a backup setting is on holiday. Describe the database as code:

- A reusable **module** with an RDS for PostgreSQL instance and a Secrets Manager secret for the application user's credentials.
- **Environments** through `tfvars` files (dev and prod), each with its own **remote state in S3 with locking**.
- **Sensitive** variables that never leak into the output, the plan or the state.

Then compare the same infrastructure written with AWS CDK: what changes in state, in the plan/apply versus synth/deploy cycle, and in how each is tested. Nothing is deployed: the proof is `terraform fmt` and `terraform validate`.

## What gets assessed

- The Terraform workflow and what the state is: `init`, `plan`, `apply`, and why the state needs a remote backend and a lock.
- Module design: inputs, outputs, provider requirements, and the root module that wires an environment.
- Secrets: an RDS-managed master password, write-only arguments with an ephemeral variable, and what `sensitive` alone does not protect.
- Environment separation with tfvars plus one backend configuration per environment, and why not workspaces here.
- The conceptual differences between Terraform and CDK.

## How to approach it, step by step

1. Write the module's interface first: the variables that change per environment and the outputs other code needs.
2. Write the resources with production defaults: private, encrypted, backed up, protected from deletion, master password managed by RDS.
3. Decide where each secret comes from and check that no secret value is ever stored in the state.
4. Write the root module (provider, tags, module call), its variables with `validation` blocks, and one tfvars file per environment.
5. Configure the S3 backend with `use_lockfile`, leaving bucket and key to a per-environment backend file.
6. Run `terraform fmt -recursive`, `terraform init -backend=false` and `terraform validate`; commit `.terraform.lock.hcl`.
7. Write the CDK equivalent and list what differs.

## Solution explained

```text
terraform/
├── versions.tf            Terraform ~> 1.17, AWS provider ~> 6.74
├── backend.tf             backend "s3" with use_lockfile = true (bucket and key per environment)
├── main.tf                provider with default tags, module "postgres"
├── variables.tf           inputs with validation; app_db_password sensitive and ephemeral
├── outputs.tf
├── .terraform.lock.hcl    exact provider version and hashes
├── envs/
│   ├── dev.tfvars         dev.s3.tfbackend
│   └── prod.tfvars        prod.s3.tfbackend
└── modules/postgres/      subnet group, DB instance, app-user secret and its version
```

**The module.** [`modules/postgres`](./terraform/modules/postgres/) takes what varies (subnets, security groups, size, multi-AZ, retention, deletion protection, the application password) and returns the endpoint and the two secret ARNs. It declares the provider it needs with a minimum version (`>= 6.0`); the root module pins the exact range (`~> 6.74`), and [`.terraform.lock.hcl`](./terraform/.terraform.lock.hcl) records the version and the package hashes that `init` must install, so every machine and CI run uses the same provider.

**The database.** [`main.tf`](./terraform/modules/postgres/main.tf) creates `aws_db_instance` with:

- `engine_version = "16"` and `auto_minor_version_upgrade`: the major version is a decision in code, minor versions arrive in the maintenance window.
- `storage_encrypted`, `gp3` storage with autoscaling up to `max_allocated_storage`, `publicly_accessible = false` inside a private subnet group.
- `backup_retention_period` from the environment (1 day in dev, 14 in prod; the provider's default of 0 would disable backups and point-in-time recovery), plus `skip_final_snapshot = false` and `deletion_protection`, so deleting prod takes two deliberate changes.
- `multi_az` in prod: a synchronous standby in another zone with automatic failover.
- `iam_database_authentication_enabled`, so users granted `rds_iam` can log in with 15-minute IAM tokens instead of passwords.

**Secrets that never reach the state.** Terraform stores every attribute it manages in the state file, in plain text. `sensitive = true` only hides a value in the CLI output: it is still in the state and in a saved plan. So:

- The **master password** is never in Terraform: `manage_master_user_password = true` makes RDS generate it, keep it in a Secrets Manager secret (its ARN is the output `master_user_secret_arn`) and rotate it every 7 days by default.
- The **application user's** credentials go into `aws_secretsmanager_secret_version` through `secret_string_wo`, a **write-only** argument (Terraform 1.11+): Terraform sends it to AWS and never stores it. Its value comes from `app_db_password`, an **ephemeral** variable (Terraform 1.10+), which can only flow into write-only arguments and other ephemeral contexts and is never written to the plan or the state; it is also `sensitive`, so it never appears in the output. It is passed as `TF_VAR_app_db_password` from the CI secret store. Because Terraform keeps no copy, it cannot detect a change: `secret_string_wo_version` is the trigger, and increasing it writes the new value.

The tfvars files hold no secret at all, so they can be reviewed like code.

**Environments.** The same root module runs per environment with two files: [`envs/prod.tfvars`](./terraform/envs/prod.tfvars) (sizes and protections) and [`envs/prod.s3.tfbackend`](./terraform/envs/prod.s3.tfbackend) (where the state lives):

```bash
terraform init -backend-config=envs/prod.s3.tfbackend      # -reconfigure when switching environments
terraform plan -var-file=envs/prod.tfvars -out=prod.tfplan  # review what will change
terraform apply prod.tfplan                                 # applies exactly the reviewed plan
```

Each environment has its own state (here, in a bucket of its own AWS account), so a mistake in dev cannot touch prod's state, and each pipeline role only needs access to its environment's bucket. Workspaces would keep several states under one backend and one set of credentials, which does not fit one account per environment. `validation` blocks reject an unknown environment or a backup retention outside 1–35 days at plan time, and `default_tags` puts `Project`, `Environment` and `ManagedBy` on every resource.

**Remote state and locking.** The state maps the code to real resource ids; losing it means Terraform no longer knows what it manages, and two people applying at once can corrupt it. The S3 backend stores it remotely (`encrypt = true`; with bucket versioning, an earlier state can be recovered), and `use_lockfile = true` takes a lock with a `.tflock` object next to the state file, so a second `apply` waits or fails instead of racing. The DynamoDB table that older setups used for locking is deprecated. The state still holds non-secret but sensitive details (endpoints, ARNs), so access to the bucket is restricted to the pipeline roles.

**The same with AWS CDK.** An illustrative TypeScript equivalent. ⚠️ Verify: it is not compiled in this kata; check the props against the [`DatabaseInstance` API reference](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_rds.DatabaseInstance.html).

```ts
const db = new rds.DatabaseInstance(this, 'Postgres', {
  engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.M7G, ec2.InstanceSize.LARGE),
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  credentials: rds.Credentials.fromGeneratedSecret('postgres_admin'), // generated into Secrets Manager
  multiAz: props.multiAz,
  allocatedStorage: 100,
  maxAllocatedStorage: 500,
  storageEncrypted: true,
  backupRetention: Duration.days(props.backupRetentionDays),
  deletionProtection: props.deletionProtection,
  iamAuthentication: true,
  removalPolicy: RemovalPolicy.SNAPSHOT,
});
const appUser = new secretsmanager.Secret(this, 'AppUser', { secretName: `katas-${props.environment}/app-user` });
```

Environments become stack instances with different props (`new DatabaseStack(app, 'katas-prod', { env, multiAz: true, … })`) instead of tfvars files.

| Aspect             | Terraform                                                           | AWS CDK                                                                                        |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Language           | HCL, declarative, with modules                                      | TypeScript (or Python, Java…), synthesized to CloudFormation templates                         |
| State              | A state file you host and lock (S3 + lock file)                     | Managed by CloudFormation per stack; nothing to host or lock                                   |
| Preview and change | `plan` (saved and applied as reviewed) → `apply` calls the AWS APIs | `synth` → `diff` (or a change set) → `deploy` hands the template to CloudFormation             |
| Failure mid-change | Stops; what was created stays in the state, fix and apply again     | CloudFormation rolls the stack back to the last good state automatically                       |
| Drift              | `plan` shows differences between state, code and reality            | CloudFormation drift detection, run on demand                                                  |
| Abstractions       | Modules (inputs and outputs)                                        | Constructs: L1 (raw CloudFormation), L2 (defaults and helpers like `grantRead`), L3 (patterns) |
| Providers          | Any provider (AWS, GitHub, Datadog, Kubernetes…) in one plan        | AWS only (other systems through custom resources)                                              |
| Testing            | `fmt`, `validate`, `terraform test`, policy tools on the plan JSON  | Unit tests on the synthesized template (`Template.fromStack(…).hasResourceProperties`)         |
| Secrets            | Keep them out of state (managed passwords, write-only, ephemeral)   | Secrets Manager references resolved by CloudFormation at deploy time                           |

Neither is better in general: CDK fits teams that live in AWS and want programming-language abstractions and managed state; Terraform fits several providers or clouds, and teams that want an explicit, reviewable plan.

**How it is proven.** `npm run validate:terraform` runs Terraform 1.17.2 in Docker without AWS credentials: `terraform fmt -check -recursive -diff` finds nothing to reformat, and `terraform init -backend=false -lockfile=readonly` plus `terraform validate` succeed. `validate` checks syntax, types, references between resources and modules, and every argument against the AWS provider 6.74 schema; it also accepted `secret_string_wo` with an ephemeral variable, which is why the kata uses them. It does not contact AWS, so it cannot catch an invalid instance class for the region, quota limits or permission errors: that needs `terraform plan` against an account.

## Common mistakes

| Symptom                                                     | Cause                                                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| The database password is readable in the state file         | It was passed to a normal argument (`password`, `secret_string`); `sensitive` does not prevent it. |
| Changing the write-only password does nothing               | `secret_string_wo_version` was not increased; Terraform cannot diff a value it does not keep.      |
| `Error acquiring the state lock`                            | Another plan or apply is running, or one crashed; `force-unlock` only after checking.              |
| Prod was planned with dev's state                           | Backend switched without `init -reconfigure -backend-config=envs/prod.s3.tfbackend`.               |
| Backups were off for months                                 | `backup_retention_period` left at the provider default of 0.                                       |
| `terraform destroy` removed the database without a snapshot | `skip_final_snapshot = true` and no `deletion_protection`.                                         |
| Different provider versions on different machines           | `.terraform.lock.hcl` not committed.                                                               |

## Practice

Add a `terraform test` file (`tests/postgres.tftest.hcl`) with `command = plan` and a mocked AWS provider that asserts prod gets `multi_az = true` and `deletion_protection = true`, and run it in the same Docker image.
