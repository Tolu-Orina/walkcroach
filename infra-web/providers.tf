provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "walkcroach"
      Environment = var.environment
      ManagedBy   = "terraform"
      Stack       = "infra-web"
    }
  }
}

# ACM for CloudFront must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "walkcroach"
      Environment = var.environment
      ManagedBy   = "terraform"
      Stack       = "infra-web"
    }
  }
}
