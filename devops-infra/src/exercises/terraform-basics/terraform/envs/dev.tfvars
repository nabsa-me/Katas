environment = "dev"

subnet_ids             = ["subnet-0aaaaaaaaaaaaaaa1", "subnet-0aaaaaaaaaaaaaaa2"]
vpc_security_group_ids = ["sg-0aaaaaaaaaaaaaaa1"]

# Small and cheap: one AZ, short retention, and it can be deleted.
db_instance_class        = "db.t4g.micro"
db_allocated_storage     = 20
db_multi_az              = false
db_backup_retention_days = 1
db_deletion_protection   = false
