variable "environment" {
  description = "Environment name; it names the resources and selects the state file."
  type        = string

  validation {
    condition     = contains(["dev", "int", "stag", "prod"], var.environment)
    error_message = "environment must be one of dev, int, stag or prod."
  }
}

variable "aws_region" {
  description = "AWS region for every resource."
  type        = string
  default     = "eu-west-1"
}

variable "subnet_ids" {
  description = "Private subnets, in at least two availability zones, for the database subnet group."
  type        = list(string)
}

variable "vpc_security_group_ids" {
  description = "Security groups for the database; they decide who can open a connection on 5432."
  type        = list(string)
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
}

variable "db_allocated_storage" {
  description = "Initial storage in GiB; storage autoscaling can grow it."
  type        = number
}

variable "db_multi_az" {
  description = "Synchronous standby in another availability zone, with automatic failover."
  type        = bool
}

variable "db_backup_retention_days" {
  description = "Days of automated backups and point-in-time recovery (0 disables them)."
  type        = number

  validation {
    condition     = var.db_backup_retention_days >= 1 && var.db_backup_retention_days <= 35
    error_message = "Keep between 1 and 35 days of backups."
  }
}

variable "db_deletion_protection" {
  description = "Blocks deleting the instance until this is turned off in a separate change."
  type        = bool
}

variable "app_db_password" {
  description = "Password of the application's database user. Pass it as TF_VAR_app_db_password from a secret store."
  type        = string
  # Sensitive: hidden in plan and apply output. Ephemeral: never written to the plan file or the state.
  sensitive = true
  ephemeral = true
}

variable "app_db_password_version" {
  description = "Increase it to write a new password: write-only values are not stored, so Terraform cannot diff them."
  type        = number
  default     = 1
}
