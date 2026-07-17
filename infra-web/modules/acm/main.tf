variable "domain_name" {
  type        = string
  description = "FQDN for the SPA (e.g. walkcroach.conquerorfoundation.com)"
}

variable "hosted_zone_name" {
  type        = string
  description = "Public Route53 hosted zone (parent domain)"
}

variable "tags" {
  type    = map(string)
  default = {}
}

data "aws_route53_zone" "this" {
  name         = var.hosted_zone_name
  private_zone = false
}

# CloudFront requires ACM certificates in us-east-1.
resource "aws_acm_certificate" "web" {
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = var.tags
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.web.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.this.zone_id
}

resource "aws_acm_certificate_validation" "web" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

output "certificate_arn" {
  value = aws_acm_certificate_validation.web.certificate_arn
}

output "hosted_zone_id" {
  value = data.aws_route53_zone.this.zone_id
}

output "domain_name" {
  value = var.domain_name
}
