# Remote state in S3, one state file per environment. The bucket, key and region come from
# envs/<environment>.s3.tfbackend at init time:
#   terraform init -backend-config=envs/prod.s3.tfbackend
terraform {
  backend "s3" {
    # Native S3 locking: a lock object next to the state file. The DynamoDB table is no longer needed.
    use_lockfile = true
    encrypt      = true
  }
}
