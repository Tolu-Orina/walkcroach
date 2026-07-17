variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "s3_bucket_id" {
  type = string
}

variable "s3_bucket_regional_domain_name" {
  type = string
}

variable "price_class" {
  type = string
}

variable "aliases" {
  type        = list(string)
  description = "Alternate domain names (CNAMEs) for the distribution"
  default     = []
}

variable "acm_certificate_arn" {
  type        = string
  description = "us-east-1 ACM cert ARN; empty uses CloudFront default certificate"
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name_prefix}-web-${var.environment}"
  description                       = "OAC for WalkCroach web SPA"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Required for WebContainer (SharedArrayBuffer / cross-origin isolation).
resource "aws_cloudfront_response_headers_policy" "webcontainer" {
  name    = "${var.name_prefix}-webcontainer-${var.environment}"
  comment = "COOP/COEP for WebContainer"

  custom_headers_config {
    items {
      header   = "Cross-Origin-Opener-Policy"
      override = true
      value    = "same-origin"
    }
    items {
      header   = "Cross-Origin-Embedder-Policy"
      override = true
      value    = "require-corp"
    }
  }

  security_headers_config {
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "SAMEORIGIN"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.name_prefix} web ${var.environment}"
  default_root_object = "index.html"
  price_class         = var.price_class
  aliases             = var.aliases
  tags                = var.tags

  origin {
    domain_name              = var.s3_bucket_regional_domain_name
    origin_id                = "s3-web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "s3-web"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.webcontainer.id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  # SPA client-side routing
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
    for_each = var.acm_certificate_arn != "" ? [1] : []
    content {
      acm_certificate_arn      = var.acm_certificate_arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }

  dynamic "viewer_certificate" {
    for_each = var.acm_certificate_arn == "" ? [1] : []
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
      "arn:aws:s3:::${var.s3_bucket_id}/*",
    ]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = var.s3_bucket_id
  policy = data.aws_iam_policy_document.s3_oac.json
}

output "distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.web.arn
}

output "domain_name" {
  value = aws_cloudfront_distribution.web.domain_name
}

output "url" {
  value = length(var.aliases) > 0 ? "https://${var.aliases[0]}" : "https://${aws_cloudfront_distribution.web.domain_name}"
}
