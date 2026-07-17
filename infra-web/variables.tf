variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "eu-west-2"
}

variable "environment" {
  type = string

  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "environment must be dev, test, or prod."
  }
}

variable "project_name" {
  type    = string
  default = "walkcroach"
}

variable "price_class" {
  type        = string
  description = "CloudFront price class"
  default     = "PriceClass_100"
}

variable "domain_name" {
  type        = string
  description = "Custom domain for the SPA (empty = CloudFront default URL only)"
  default     = ""
}

variable "hosted_zone_name" {
  type        = string
  description = "Route53 public hosted zone that contains domain_name"
  default     = "conquerorfoundation.com"
}
