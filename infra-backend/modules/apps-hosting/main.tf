variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "hosted_zone_name" {
  type        = string
  description = "Route53 parent zone (e.g. conquerorfoundation.com)"
  default     = ""
}

variable "apps_wildcard_domain" {
  type        = string
  description = "Base domain for deployed apps; slug becomes {slug}.{apps_wildcard_domain}"
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}

locals {
  use_custom_domain = var.apps_wildcard_domain != "" && var.hosted_zone_name != ""
  wildcard_fqdn     = local.use_custom_domain ? "*.${var.apps_wildcard_domain}" : ""
}

data "aws_route53_zone" "this" {
  count        = local.use_custom_domain ? 1 : 0
  name         = var.hosted_zone_name
  private_zone = false
}

resource "aws_s3_bucket" "apps" {
  bucket = "${var.name_prefix}-apps-${var.environment}"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "apps" {
  bucket = aws_s3_bucket.apps.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "apps" {
  bucket = aws_s3_bucket.apps.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_acm_certificate" "apps" {
  count             = local.use_custom_domain ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = local.wildcard_fqdn
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = var.tags
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.use_custom_domain ? {
    for dvo in aws_acm_certificate.apps[0].domain_validation_options : dvo.domain_name => {
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
  zone_id         = data.aws_route53_zone.this[0].zone_id
}

resource "aws_acm_certificate_validation" "apps" {
  count                   = local.use_custom_domain ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.apps[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_cloudfront_origin_access_control" "apps" {
  name                              = "${var.name_prefix}-apps-${var.environment}"
  description                       = "OAC for WalkCroach deployed user apps"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "apps_router" {
  name    = "${var.name_prefix}-apps-router-${var.environment}"
  runtime = "cloudfront-js-2.0"
  comment = "Route {slug}.walkcroach.conquerorfoundation.com to S3 /{slug}/live/"
  publish = true
  code    = <<-EOF
function handler(event) {
  var request = event.request;
  var host = request.headers.host.value;
  var uri = request.uri;
  var slug = host.split(".")[0];
  if (host.indexOf("cloudfront.net") >= 0) {
    if (uri === "/" || uri.indexOf(".") === -1) {
      request.uri = uri === "/" ? "/index.html" : uri + "/index.html";
    }
    return request;
  }
  if (!slug || slug === "walkcroach") {
    return request;
  }
  if (uri === "/" || uri.indexOf(".") === -1) {
    request.uri = "/" + slug + "/live/index.html";
  } else {
    request.uri = "/" + slug + "/live" + uri;
  }
  return request;
}
EOF
}

resource "aws_cloudfront_distribution" "apps" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.name_prefix} user apps ${var.environment}"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  aliases             = local.use_custom_domain ? [local.wildcard_fqdn] : []
  tags                = var.tags

  origin {
    domain_name              = aws_s3_bucket.apps.bucket_regional_domain_name
    origin_id                = "s3-apps"
    origin_access_control_id = aws_cloudfront_origin_access_control.apps.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-apps"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.apps_router.arn
    }

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  dynamic "viewer_certificate" {
    for_each = local.use_custom_domain ? [1] : []
    content {
      acm_certificate_arn      = aws_acm_certificate_validation.apps[0].certificate_arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }

  dynamic "viewer_certificate" {
    for_each = local.use_custom_domain ? [] : [1]
    content {
      cloudfront_default_certificate = true
    }
  }
}

data "aws_iam_policy_document" "s3_oac" {
  statement {
    sid     = "AllowCloudFrontServicePrincipal"
    actions = ["s3:GetObject"]
    resources = [
      "${aws_s3_bucket.apps.arn}/*",
    ]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.apps.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "apps" {
  bucket = aws_s3_bucket.apps.id
  policy = data.aws_iam_policy_document.s3_oac.json
}

resource "aws_route53_record" "apps_wildcard" {
  count   = local.use_custom_domain ? 1 : 0
  zone_id = data.aws_route53_zone.this[0].zone_id
  name    = local.wildcard_fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.apps.domain_name
    zone_id                = aws_cloudfront_distribution.apps.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "apps_wildcard_aaaa" {
  count   = local.use_custom_domain ? 1 : 0
  zone_id = data.aws_route53_zone.this[0].zone_id
  name    = local.wildcard_fqdn
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.apps.domain_name
    zone_id                = aws_cloudfront_distribution.apps.hosted_zone_id
    evaluate_target_health = false
  }
}

data "aws_iam_policy_document" "codebuild_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "codebuild" {
  name               = "${var.name_prefix}-${var.environment}-app-deploy-build"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "codebuild" {
  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }

  statement {
    sid = "S3"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.apps.arn,
      "${aws_s3_bucket.apps.arn}/*",
      "arn:aws:s3:::${var.name_prefix}-artefacts-${var.environment}",
      "arn:aws:s3:::${var.name_prefix}-artefacts-${var.environment}/*",
    ]
  }
}

resource "aws_iam_role_policy" "codebuild" {
  name   = "${var.name_prefix}-${var.environment}-app-deploy-build"
  role   = aws_iam_role.codebuild.id
  policy = data.aws_iam_policy_document.codebuild.json
}

resource "aws_cloudwatch_log_group" "codebuild" {
  name              = "/aws/codebuild/${var.name_prefix}-${var.environment}-app-deploy"
  retention_in_days = 14
  tags              = var.tags
}

resource "aws_codebuild_project" "app_deploy" {
  name          = "${var.name_prefix}-${var.environment}-app-deploy"
  description   = "Build and publish WalkCroach user app snapshots"
  service_role  = aws_iam_role.codebuild.arn
  build_timeout = 15

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/standard:7.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.codebuild.name
    }
  }

  source {
    type      = "NO_SOURCE"
    buildspec = file("${path.module}/../../buildspec-app-deploy.yml")
  }

  tags = var.tags
}

output "apps_bucket_id" {
  value = aws_s3_bucket.apps.id
}

output "apps_bucket_arn" {
  value = aws_s3_bucket.apps.arn
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.apps.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.apps.id
}

output "apps_wildcard_domain" {
  value = var.apps_wildcard_domain
}

output "codebuild_project_name" {
  value = aws_codebuild_project.app_deploy.name
}

output "deploy_url_pattern" {
  value = local.use_custom_domain ? "https://{slug}.${var.apps_wildcard_domain}" : "https://${aws_cloudfront_distribution.apps.domain_name}/{slug}"
}
