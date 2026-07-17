variable "domain_name" {
  type = string
}

variable "hosted_zone_id" {
  type = string
}

variable "cloudfront_domain_name" {
  type = string
}

# CloudFront global hosted zone ID (constant).
locals {
  cloudfront_zone_id = "Z2FDTNDATAQYW2"
}

resource "aws_route53_record" "web_a" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = local.cloudfront_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "web_aaaa" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = local.cloudfront_zone_id
    evaluate_target_health = false
  }
}
