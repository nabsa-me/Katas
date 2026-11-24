environment = "prod"

subnet_ids             = ["subnet-0bbbbbbbbbbbbbbb1", "subnet-0bbbbbbbbbbbbbbb2", "subnet-0bbbbbbbbbbbbbbb3"]
vpc_security_group_ids = ["sg-0bbbbbbbbbbbbbbb1"]

# Standby in a second AZ, two weeks of point-in-time recovery, and protected from deletion.
db_instance_class        = "db.m7g.large"
db_allocated_storage     = 100
db_multi_az              = true
db_backup_retention_days = 14
db_deletion_protection   = true
