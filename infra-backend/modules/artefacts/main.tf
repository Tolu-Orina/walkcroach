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

resource "aws_s3_bucket" "artefacts" {
  bucket = "${var.name_prefix}-artefacts-${var.environment}"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "artefacts" {
  bucket = aws_s3_bucket.artefacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artefacts" {
  bucket = aws_s3_bucket.artefacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "artefacts" {
  bucket = aws_s3_bucket.artefacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

output "bucket_id" {
  value = aws_s3_bucket.artefacts.id
}

output "bucket_arn" {
  value = aws_s3_bucket.artefacts.arn
}
