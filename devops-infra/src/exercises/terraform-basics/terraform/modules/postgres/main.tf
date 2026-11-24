resource "aws_db_subnet_group" "this" {
  name        = var.name
  description = "Private subnets for ${var.name}"
  subnet_ids  = var.subnet_ids
}

resource "aws_db_instance" "this" {
  identifier = var.name

  engine = "postgres"
  # Major version only: AWS applies minor versions in the maintenance window.
  engine_version             = "16"
  auto_minor_version_upgrade = true
  instance_class             = var.instance_class

  storage_type          = "gp3"
  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_encrypted     = true

  db_name  = var.database_name
  username = "postgres_admin"
  # RDS generates the master password, stores it in Secrets Manager and rotates it (every 7 days by
  # default). It never appears in Terraform code, plan or state.
  manage_master_user_password = true
  # Lets users log in with a 15-minute IAM token instead of a password (GRANT rds_iam TO <user>).
  iam_database_authentication_enabled = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = var.vpc_security_group_ids
  publicly_accessible    = false
  multi_az               = var.multi_az

  backup_retention_period   = var.backup_retention_period
  backup_window             = "02:00-02:30"
  maintenance_window        = "sun:03:00-sun:04:00"
  copy_tags_to_snapshot     = true
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final"
}

# The application's credentials, in their own secret so the app never sees the master password.
resource "aws_secretsmanager_secret" "app_user" {
  name                    = "${var.name}/app-user"
  description             = "Credentials of the ${var.app_username} database user"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app_user" {
  secret_id = aws_secretsmanager_secret.app_user.id
  # Write-only argument: sent to AWS on create or update, never stored in the plan or the state.
  secret_string_wo = jsonencode({
    username = var.app_username
    password = var.app_password
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    dbname   = var.database_name
  })
  # Terraform cannot compare a value it does not keep: a new version number is what triggers the update.
  secret_string_wo_version = var.app_password_version
}
