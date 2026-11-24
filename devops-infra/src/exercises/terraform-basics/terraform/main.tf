provider "aws" {
  region = var.aws_region

  # Every resource gets these tags, so cost reports and audits can filter by them.
  default_tags {
    tags = {
      Project     = "katas"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

module "postgres" {
  source = "./modules/postgres"

  name                    = "katas-${var.environment}"
  subnet_ids              = var.subnet_ids
  vpc_security_group_ids  = var.vpc_security_group_ids
  instance_class          = var.db_instance_class
  allocated_storage       = var.db_allocated_storage
  multi_az                = var.db_multi_az
  backup_retention_period = var.db_backup_retention_days
  deletion_protection     = var.db_deletion_protection
  app_password            = var.app_db_password
  app_password_version    = var.app_db_password_version
}
