terraform {
  required_providers {
    # The module declares what it needs; the root module chooses the exact version.
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0"
    }
  }
}
