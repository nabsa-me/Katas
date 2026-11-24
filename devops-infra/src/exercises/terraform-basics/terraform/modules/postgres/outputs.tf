output "endpoint" {
  description = "Host and port of the instance."
  value       = aws_db_instance.this.endpoint
}

output "master_user_secret_arn" {
  description = "Secret with the master password, managed by RDS."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "app_user_secret_arn" {
  description = "Secret with the application user's credentials."
  value       = aws_secretsmanager_secret.app_user.arn
}
