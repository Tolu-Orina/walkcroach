# WalkCroach lambda-creative (container image).
#
# Phase B: pptx render + skill-script runner. Image is built/pushed by CI
# (docker build of this module) then tagged into ECR.

variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "artefacts_bucket_arn" {
  type = string
}

variable "artefacts_bucket_name" {
  type = string
}

variable "image_uri" {
  type        = string
  description = "Full ECR image URI for lambda-creative (empty = skip function create)"
  default     = ""
}

variable "timeout" {
  type    = number
  default = 300
}

variable "memory_mb" {
  type    = number
  default = 3008
}

variable "tags" {
  type    = map(string)
  default = {}
}

resource "aws_ecr_repository" "creative" {
  name                 = "${var.name_prefix}-creative"
  image_tag_mutability = "MUTABLE"
  force_delete         = var.environment != "prod"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "creative" {
  repository = aws_ecr_repository.creative.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "creative" {
  name               = "${var.name_prefix}-lambda-creative"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "creative" {
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
    sid = "Artefacts"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      var.artefacts_bucket_arn,
      "${var.artefacts_bucket_arn}/*",
    ]
  }
}

resource "aws_iam_role_policy" "creative" {
  name   = "creative"
  role   = aws_iam_role.creative.id
  policy = data.aws_iam_policy_document.creative.json
}

resource "aws_cloudwatch_log_group" "creative" {
  name              = "/aws/lambda/${var.name_prefix}-creative"
  retention_in_days = 14
  tags              = var.tags
}

# Function is only created once an image URI is supplied (CI pushes first).
resource "aws_lambda_function" "creative" {
  count = var.image_uri != "" ? 1 : 0

  function_name = "${var.name_prefix}-creative"
  role          = aws_iam_role.creative.arn
  package_type  = "Image"
  image_uri     = var.image_uri
  timeout       = var.timeout
  memory_size   = var.memory_mb

  environment {
    variables = {
      ENVIRONMENT               = var.environment
      ARTEFACTS_BUCKET          = var.artefacts_bucket_name
      WALKCROACH_WEB_SKILLS_DIR = "/opt/skills/web"
    }
  }

  depends_on = [aws_cloudwatch_log_group.creative]
  tags       = var.tags
}

output "ecr_repository_url" {
  value = aws_ecr_repository.creative.repository_url
}

output "function_name" {
  value = try(aws_lambda_function.creative[0].function_name, "")
}

output "function_arn" {
  value = try(aws_lambda_function.creative[0].arn, "")
}

output "role_arn" {
  value = aws_iam_role.creative.arn
}
