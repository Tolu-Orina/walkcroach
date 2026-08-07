# Custom domain for the shared REST API (Phase P5.1).
#
# Regional ACM (same region as the API — eu-west-2). CloudFront SPA certs stay
# in us-east-1; do not reuse them here.
#
# Base-path mapping keeps `/v1` in the public URL so SDK paths (`/v1/memory/…`)
# and CLI/IDE bases (`…/v1`) stay compatible with execute-api.

variable "api_custom_domain_name" {
  type        = string
  description = "Public API hostname, e.g. api.walkcroach.rinegansolutions.com. Empty disables."
  default     = ""
}

variable "hosted_zone_name" {
  type        = string
  description = "Route53 zone that will host the API A/AAAA records"
  default     = ""
}

locals {
  enable_api_domain = var.api_custom_domain_name != "" && var.hosted_zone_name != ""
}

data "aws_route53_zone" "api" {
  count        = local.enable_api_domain ? 1 : 0
  name         = var.hosted_zone_name
  private_zone = false
}

resource "aws_acm_certificate" "api" {
  count             = local.enable_api_domain ? 1 : 0
  domain_name       = var.api_custom_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = var.tags
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = local.enable_api_domain ? {
    for dvo in aws_acm_certificate.api[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.api[0].zone_id
}

resource "aws_acm_certificate_validation" "api" {
  count                   = local.enable_api_domain ? 1 : 0
  certificate_arn         = aws_acm_certificate.api[0].arn
  validation_record_fqdns = [for r in aws_route53_record.api_cert_validation : r.fqdn]
}

resource "aws_api_gateway_domain_name" "api" {
  count                    = local.enable_api_domain ? 1 : 0
  domain_name              = var.api_custom_domain_name
  regional_certificate_arn = aws_acm_certificate_validation.api[0].certificate_arn

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = var.tags
}

# Preserve `/v1` in the public path (matches execute-api stage name).
resource "aws_api_gateway_base_path_mapping" "api_v1" {
  count       = local.enable_api_domain ? 1 : 0
  api_id      = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.this.stage_name
  domain_name = aws_api_gateway_domain_name.api[0].domain_name
  base_path   = var.stage_name
}

resource "aws_route53_record" "api_a" {
  count   = local.enable_api_domain ? 1 : 0
  zone_id = data.aws_route53_zone.api[0].zone_id
  name    = var.api_custom_domain_name
  type    = "A"

  alias {
    name                   = aws_api_gateway_domain_name.api[0].regional_domain_name
    zone_id                = aws_api_gateway_domain_name.api[0].regional_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api_aaaa" {
  count   = local.enable_api_domain ? 1 : 0
  zone_id = data.aws_route53_zone.api[0].zone_id
  name    = var.api_custom_domain_name
  type    = "AAAA"

  alias {
    name                   = aws_api_gateway_domain_name.api[0].regional_domain_name
    zone_id                = aws_api_gateway_domain_name.api[0].regional_zone_id
    evaluate_target_health = false
  }
}

output "api_custom_domain_url" {
  description = "Public API origin with stage base path, or empty when disabled"
  value       = local.enable_api_domain ? "https://${var.api_custom_domain_name}/${var.stage_name}" : ""
}

output "api_custom_domain_name" {
  value = local.enable_api_domain ? var.api_custom_domain_name : ""
}
