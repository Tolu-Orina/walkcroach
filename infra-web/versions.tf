terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.55"
    }
  }

  # Uncomment after creating the state bucket (once per account):
  # backend "s3" {
  #   bucket         = "walkcroach-tf-state"
  #   key            = "web/dev/terraform.tfstate"
  #   region         = "eu-west-2"
  #   encrypt        = true
  #   dynamodb_table = "walkcroach-tf-lock"
  # }
}
