variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "zip_path" {
  type = string
}

variable "handler" {
  type = string
}

variable "runtime" {
  type = string
}

variable "timeout" {
  type = number
}

variable "memory_mb" {
  type = number
}

variable "bedrock_region" {
  type = string
}

variable "nova_model_id" {
  type = string
}

variable "titan_embed_model_id" {
  type = string
}

variable "runtime_secret_arn" {
  type = string
}

variable "artefacts_bucket_arn" {
  type = string
}

variable "artefacts_bucket_name" {
  type = string
}

variable "apps_bucket_arn" {
  type = string
}

variable "apps_bucket_name" {
  type = string
}

variable "apps_wildcard_domain" {
  type    = string
  default = ""
}

variable "apps_cf_domain" {
  type = string
}

variable "codebuild_project" {
  type = string
}

variable "cognito_user_pool_id" {
  type    = string
  default = ""
}

variable "cognito_client_id" {
  type    = string
  default = ""
}

variable "allow_dev_auth" {
  type    = bool
  default = true
}

variable "allow_github_pat" {
  type        = bool
  description = "Allow legacy PAT connect (disable in prod when GitHub App is configured)"
  default     = true
}

variable "github_ssm_prefix" {
  type        = string
  description = "SSM path prefix for GitHub App params (default /walkcroach/{env}/github)"
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.name_prefix}-${var.environment}-agent-lambda"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "lambda" {
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
    sid = "Secrets"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:CreateSecret",
      "secretsmanager:PutSecretValue",
      "secretsmanager:TagResource",
    ]
    resources = [
      var.runtime_secret_arn,
      "arn:aws:secretsmanager:*:*:secret:walkcroach/${var.environment}/projects/*",
    ]
  }

  statement {
    sid = "Bedrock"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:Converse",
      "bedrock:ConverseStream",
    ]
    resources = ["*"]
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

  statement {
    sid = "AppsHosting"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:ListBucket",
    ]
    resources = [
      var.apps_bucket_arn,
      "${var.apps_bucket_arn}/*",
    ]
  }

  statement {
    sid = "AppDeployCodeBuild"
    actions = [
      "codebuild:StartBuild",
      "codebuild:BatchGetBuilds",
    ]
    resources = ["*"]
  }

  statement {
    sid = "GitHubAppSSM"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
    ]
    resources = [
      "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.name_prefix}/${var.environment}/github/*",
    ]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${var.name_prefix}-${var.environment}-agent-lambda"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name_prefix}-${var.environment}-agent"
  retention_in_days = 14
  tags              = var.tags
}

resource "aws_lambda_function" "agent" {
  function_name    = "${var.name_prefix}-${var.environment}-agent"
  role             = aws_iam_role.lambda.arn
  handler          = var.handler
  runtime          = var.runtime
  timeout          = var.timeout
  memory_size      = var.memory_mb
  filename         = var.zip_path
  source_code_hash = filebase64sha256(var.zip_path)

  environment {
    variables = {
      ENVIRONMENT          = var.environment
      BEDROCK_REGION       = var.bedrock_region
      NOVA_MODEL_ID        = var.nova_model_id
      TITAN_EMBED_MODEL_ID = var.titan_embed_model_id
      RUNTIME_SECRET_ARN   = var.runtime_secret_arn
      ARTEFACTS_BUCKET     = var.artefacts_bucket_name
      APPS_BUCKET          = var.apps_bucket_name
      APPS_WILDCARD_DOMAIN = var.apps_wildcard_domain
      APPS_CF_DOMAIN       = var.apps_cf_domain
      CODEBUILD_PROJECT    = var.codebuild_project
      COGNITO_USER_POOL_ID = var.cognito_user_pool_id
      COGNITO_CLIENT_ID    = var.cognito_client_id
      ALLOW_DEV_AUTH       = var.allow_dev_auth ? "true" : "false"
      ALLOW_GITHUB_PAT     = var.allow_github_pat ? "true" : "false"
      GITHUB_SSM_PREFIX    = var.github_ssm_prefix != "" ? var.github_ssm_prefix : "/${var.name_prefix}/${var.environment}/github"
      NODE_OPTIONS         = "--enable-source-maps"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda,
  ]

  tags = var.tags
}

output "function_name" {
  value = aws_lambda_function.agent.function_name
}

output "function_arn" {
  value = aws_lambda_function.agent.arn
}

output "invoke_arn" {
  value = aws_lambda_function.agent.invoke_arn
}

output "role_arn" {
  value = aws_iam_role.lambda.arn
}
