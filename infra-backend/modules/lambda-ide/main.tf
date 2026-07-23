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
  default = false
}

variable "cors_allow_origin" {
  type        = string
  description = "Access-Control-Allow-Origin for IDE BFF responses"
  default     = "*"
}

variable "tags" {
  type    = map(string)
  default = {}
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

resource "aws_iam_role" "lambda" {
  name               = "${var.name_prefix}-${var.environment}-ide-lambda"
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
    ]
    resources = [var.runtime_secret_arn]
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
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${var.name_prefix}-${var.environment}-ide-lambda"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name_prefix}-${var.environment}-ide"
  retention_in_days = 14
  tags              = var.tags
}

resource "aws_lambda_function" "ide" {
  function_name    = "${var.name_prefix}-${var.environment}-ide"
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
      COGNITO_USER_POOL_ID = var.cognito_user_pool_id
      COGNITO_CLIENT_ID    = var.cognito_client_id
      ALLOW_DEV_AUTH       = var.allow_dev_auth ? "true" : "false"
      CORS_ALLOW_ORIGIN    = var.cors_allow_origin
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
  value = aws_lambda_function.ide.function_name
}

output "function_arn" {
  value = aws_lambda_function.ide.arn
}

output "invoke_arn" {
  value = aws_lambda_function.ide.invoke_arn
}

output "role_arn" {
  value = aws_iam_role.lambda.arn
}
