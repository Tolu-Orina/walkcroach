variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

resource "aws_s3_bucket" "web" {
  bucket = "${var.name_prefix}-web-${var.environment}"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id

  versioning_configuration {
    status = "Enabled"
  }
}

output "bucket_id" {
  value = aws_s3_bucket.web.id
}

output "bucket_arn" {
  value = aws_s3_bucket.web.arn
}

output "bucket_regional_domain_name" {
  value = aws_s3_bucket.web.bucket_regional_domain_name
}
