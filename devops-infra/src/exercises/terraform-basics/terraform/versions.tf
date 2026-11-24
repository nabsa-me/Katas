terraform {
  # Write-only arguments need 1.11 and ephemeral variables 1.10; the kata validates with 1.17.
  required_version = "~> 1.17"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.74"
    }
  }
}
