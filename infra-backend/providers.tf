provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "walkcroach"
      Environment = var.environment
      ManagedBy   = "terraform"
      Stack       = "infra-backend"
    }
  }
}
