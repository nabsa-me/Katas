output "db_endpoint" {
  description = "Host and port to connect to."
  value       = module.postgres.endpoint
}

output "master_user_secret_arn" {
  description = "Secret holding the master password, created and rotated by RDS."
  value       = module.postgres.master_user_secret_arn
}

output "app_user_secret_arn" {
  description = "Secret holding the application user's credentials."
  value       = module.postgres.app_user_secret_arn
}
