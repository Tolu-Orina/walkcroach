# Screenshot-to-memory storage (Phase D4).
#
# A dedicated bucket rather than the shared artefacts bucket: these are user
# screenshots, which carry a different retention and disclosure posture from
# build artefacts and deserve their own lifecycle and audit surface.
#
# Uploads use presigned PUT so image bytes never traverse the Lambda. That
# requires the bucket to accept a cross-origin PUT from the extension, hence the
# CORS configuration below — a presigned URL alone is not enough, because an
# extension page's fetch is subject to CORS for hosts it lacks permission for.

variable "screenshot_retention_days" {
  description = "Days before a stored Chrome screenshot is expired automatically."
  type        = number
  default     = 90
}

variable "extension_origins" {
  description = <<-EOT
    chrome-extension:// origins allowed to PUT screenshots. Must include the
    Chrome Web Store extension ID once published; see chrome/VERSIONING.md for
    how the ID is fixed. Empty disables presigned upload, and the extension
    falls back to posting bytes through the Lambda.
  EOT
  type        = list(string)
  default     = []
}

resource "aws_s3_bucket" "captures" {
  bucket = "${var.name_prefix}-${var.environment}-chrome-captures"
  tags   = var.tags
}

# Screenshots are personal data. Nothing here is ever public; reads go through a
# short-lived presigned GET minted by the Lambda after an ownership check.
resource "aws_s3_bucket_public_access_block" "captures" {
  bucket                  = aws_s3_bucket.captures.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "captures" {
  bucket = aws_s3_bucket.captures.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "captures" {
  bucket = aws_s3_bucket.captures.id

  versioning_configuration {
    # Deliberately off. A user deleting a capture must actually delete the
    # image, and versioning would retain it behind a delete marker.
    status = "Disabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "captures" {
  bucket = aws_s3_bucket.captures.id

  rule {
    id     = "expire-screenshots"
    status = "Enabled"

    filter {
      prefix = "chrome/"
    }

    expiration {
      days = var.screenshot_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "captures" {
  count  = length(var.extension_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.captures.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = var.extension_origins
    # Presigned PUT binds Content-Type into the signature, so the client must be
    # allowed to send it.
    allowed_headers = ["content-type"]
    max_age_seconds = 3000
  }
}

data "aws_iam_policy_document" "captures" {
  statement {
    sid = "ChromeCaptures"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]
    # Scoped to the prefix the key builder produces — the Lambda has no reason
    # to reach any other part of the bucket.
    resources = ["${aws_s3_bucket.captures.arn}/chrome/*"]
  }
}

resource "aws_iam_role_policy" "captures" {
  name   = "${var.name_prefix}-${var.environment}-chrome-captures"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.captures.json
}

output "captures_bucket" {
  description = "Bucket holding Chrome page screenshots."
  value       = aws_s3_bucket.captures.bucket
}
