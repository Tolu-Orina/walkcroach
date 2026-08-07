variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "price_class" {
  type    = string
  default = "PriceClass_100"
}

variable "tags" {
  type    = map(string)
  default = {}
}

# Dedicated bucket for Desktop IDE preview installers (large binaries).
# Not the SPA bucket — avoid SPA 404→index.html rewrites on .exe downloads.
resource "aws_s3_bucket" "desktop" {
  bucket = "${var.name_prefix}-desktop-releases-${var.environment}"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "desktop" {
  bucket = aws_s3_bucket.desktop.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "desktop" {
  bucket = aws_s3_bucket.desktop.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "desktop" {
  bucket = aws_s3_bucket.desktop.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_cors_configuration" "desktop" {
  bucket = aws_s3_bucket.desktop.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

resource "aws_cloudfront_origin_access_control" "desktop" {
  name                              = "${var.name_prefix}-desktop-${var.environment}"
  description                       = "OAC for WalkCroach Desktop IDE releases"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_cache_policy" "desktop_binaries" {
  name        = "${var.name_prefix}-desktop-binaries-${var.environment}"
  comment     = "Long cache for Desktop installers; bust via versioned keys or invalidate /preview/latest/*"
  default_ttl = 86400
  max_ttl     = 604800
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}

resource "aws_cloudfront_distribution" "desktop" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name_prefix} desktop releases ${var.environment}"
  price_class     = var.price_class
  tags            = var.tags

  origin {
    domain_name              = aws_s3_bucket.desktop.bucket_regional_domain_name
    origin_id                = "s3-desktop"
    origin_access_control_id = aws_cloudfront_origin_access_control.desktop.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-desktop"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.desktop_binaries.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "desktop_oac" {
  statement {
    sid    = "AllowCloudFrontOAC"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.desktop.arn}/*"]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.desktop.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "desktop" {
  bucket = aws_s3_bucket.desktop.id
  policy = data.aws_iam_policy_document.desktop_oac.json
}

# Stable marketing URL — always the latest unsigned Setup.exe
locals {
  latest_exe_path = "desktop/preview/latest/WalkCroach-Setup.exe"
  download_url    = "https://${aws_cloudfront_distribution.desktop.domain_name}/${local.latest_exe_path}"
}

resource "aws_ssm_parameter" "desktop_download_url" {
  name        = "/${var.name_prefix}/${var.environment}/web/desktop_download_url"
  description = "Stable CloudFront URL for Desktop IDE Setup.exe (unsigned preview)"
  type        = "String"
  value       = local.download_url
  tags        = var.tags
}

resource "aws_ssm_parameter" "desktop_cf_distribution_id" {
  name        = "/${var.name_prefix}/${var.environment}/web/desktop_cf_distribution_id"
  description = "CloudFront distribution id for Desktop releases (invalidation)"
  type        = "String"
  value       = aws_cloudfront_distribution.desktop.id
  tags        = var.tags
}

output "bucket_id" {
  value = aws_s3_bucket.desktop.id
}

output "bucket_arn" {
  value = aws_s3_bucket.desktop.arn
}

output "distribution_id" {
  value = aws_cloudfront_distribution.desktop.id
}

output "domain_name" {
  value = aws_cloudfront_distribution.desktop.domain_name
}

output "download_url" {
  description = "Stable URL for landing VITE_DESKTOP_DOWNLOAD_URL"
  value       = local.download_url
}

output "latest_object_key" {
  value = local.latest_exe_path
}
