variable "name" {
  description = "Prefix for every resource of this database."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for the DB subnet group."
  type        = list(string)
}

variable "vpc_security_group_ids" {
  description = "Security groups attached to the instance."
  type        = list(string)
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
}

variable "allocated_storage" {
  description = "Initial storage in GiB."
  type        = number
}

variable "max_allocated_storage" {
  description = "Upper limit for storage autoscaling, in GiB."
  type        = number
  default     = 500
}

variable "multi_az" {
  description = "Synchronous standby in another availability zone."
  type        = bool
}

variable "backup_retention_period" {
  description = "Days of automated backups (1 to 35)."
  type        = number
}

variable "deletion_protection" {
  description = "Block deleting the instance."
  type        = bool
}

variable "database_name" {
  description = "Database created with the instance."
  type        = string
  default     = "katas"
}

variable "app_username" {
  description = "Database user the application connects as (created by a migration, not by Terraform)."
  type        = string
  default     = "app_rw"
}

variable "app_password" {
  description = "Password of the application user. Write-only: it reaches AWS, never the state."
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "app_password_version" {
  description = "Increase to write a new password."
  type        = number
}
