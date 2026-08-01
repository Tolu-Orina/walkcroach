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

variable "enabled" {
  type        = bool
  description = <<-EOT
    Whether the creative Lambda should exist. Separate from the image tag on
    purpose.

    With a single value, blanking the tag silently destroys the function AND —
    because the video state machine keys off its ARN — the state machine with
    it. A hurried tfvars edit would tear down two pieces of infrastructure and
    look like a successful apply.

    Splitting them makes an empty tag a plan-time ERROR while enabled is true
    (see the precondition on the ECR repository below), so teardown requires
    saying so.
  EOT
  default     = false
}

variable "image_tag" {
  type        = string
  description = <<-EOT
    Tag of an image already pushed to this module's own ECR repository.
    Empty (the default) means the function is not created at all.

    A tag rather than a full URI: the repository is created by this module, so
    the registry host, account id and repository name are all already known
    here. Asking an operator to paste
    `<account>.dkr.ecr.<region>.amazonaws.com/<prefix>-creative:v1` into tfvars
    invites exactly one class of typo and couples the value to an AWS account.
    `image_uri` remains for the genuine exception — an image in some other
    registry — and wins when both are set.
  EOT
  default     = ""
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
  # Environment-scoped, matching every other module in this stack
  # (`${name_prefix}-${environment}-...`). dev, test and prod share one AWS
  # account and region and are separated only by Terraform state key, so a name
  # without the environment is a real collision between them, not a style
  # difference: whichever environment applied second would fight over the same
  # repository, and a mutable `latest` pushed by dev would silently change the
  # digest prod resolves.
  name                 = "${var.name_prefix}-${var.environment}-creative"
  image_tag_mutability = "MUTABLE"
  force_delete         = var.environment != "prod"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags

  # Hung on the repository because it is the one resource here that always
  # exists — a precondition on the Lambda would not run in the very case it
  # needs to catch, since that resource has count = 0 by then.
  lifecycle {
    precondition {
      condition     = !var.enabled || var.image_tag != "" || var.image_uri != ""
      error_message = "creative_lambda_enabled is true but no image is set. Push one with infra-backend/scripts/push-creative-image.sh and set creative_lambda_image_tag, or set creative_lambda_enabled = false to intentionally remove the creative Lambda and the video state machine."
    }
  }
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
  name               = "${var.name_prefix}-${var.environment}-lambda-creative"
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
  name              = "/aws/lambda/${var.name_prefix}-${var.environment}-creative"
  retention_in_days = 14
  tags              = var.tags
}

# Function is only created once an image URI is supplied (CI pushes first).
/**
 * Resolve the tag to a digest.
 *
 * Referencing `repo:tag` directly would leave `image_uri` textually identical
 * across image pushes, so Terraform would report no diff and the function would
 * keep running the OLD image — silently, and most acutely with a mutable tag
 * like `latest`. Pinning the digest makes a new push a real diff.
 *
 * It also fails at PLAN time with a clear "image not found" when the tag is
 * missing, rather than at apply. The pipeline builds the image in the Test
 * stage, ahead of plan, precisely so this is satisfied.
 */
data "aws_ecr_image" "creative" {
  count           = var.enabled && var.image_uri == "" ? 1 : 0
  repository_name = aws_ecr_repository.creative.name
  image_tag       = var.image_tag
}

locals {
  # count cannot depend on a resource attribute, so the decision is made from
  # variables while the URI itself is built from the repository resource.
  creative_enabled = var.enabled
  creative_image_uri = var.image_uri != "" ? var.image_uri : (
    var.enabled ? "${aws_ecr_repository.creative.repository_url}@${data.aws_ecr_image.creative[0].image_digest}" : ""
  )
}

resource "aws_lambda_function" "creative" {
  count = local.creative_enabled ? 1 : 0

  function_name = "${var.name_prefix}-${var.environment}-creative"
  role          = aws_iam_role.creative.arn
  package_type  = "Image"
  image_uri     = local.creative_image_uri
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
