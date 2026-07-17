terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.55"
    }
  }

  # Partial backend — bucket/key/region/lock filled via -backend-config in CI
  backend "s3" {}
}
