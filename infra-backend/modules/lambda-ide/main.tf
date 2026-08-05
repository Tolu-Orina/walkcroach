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

variable "worker_handler" {
  type        = string
  description = <<-EOT
    Handler export for the async run worker.

    The packaging script emits a single `index.mjs`, so both functions ship in
    one artifact and differ only by which export they name. One bundle keeps the
    API and worker from drifting; two Lambda functions give them the independent
    timeouts they need.
  EOT
  default     = "index.workerHandler"
}

variable "worker_timeout" {
  type        = number
  description = <<-EOT
    Worker Lambda timeout, seconds. A publish run reads a repository, drives up
    to 24 Bedrock iterations, and opens a pull request — minutes of work. 900 is
    Lambda's maximum and the hard ceiling on a single run; past it the run's
    lease lapses and it is failed with an actionable reason rather than hanging.
  EOT
  default     = 900
}

variable "worker_memory_mb" {
  type        = number
  description = "Worker memory. Higher than the API path: it holds repo context and the agent transcript."
  default     = 2048
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

      # Where the submit path dispatches runs. Unset would fall back to running
      # the worker in-process, which cannot outlive this function's timeout.
      WALKCROACH_WORKER_FUNCTION = aws_lambda_function.worker.function_name
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda,
  ]

  tags = var.tags
}

/**
 * Worker Lambda — same bundle, different entry point.
 *
 * Separate from the API function rather than self-invoked, for three reasons:
 *
 *   1. A function invoking itself is exactly the shape AWS's recursive-invocation
 *      detection exists to catch, so a bug becomes a throttle or a runaway bill.
 *   2. Granting a role permission to invoke its own function is awkward to
 *      review and easy to widen by accident.
 *   3. **One function cannot have two timeouts.** The worker needs the full 15
 *      minutes; the API path must fail fast. Sharing a function would give every
 *      HTTP request a 900-second timeout, so one hung request would hold a
 *      concurrency slot for a quarter of an hour.
 *
 * Same zip and same role: the worker needs Bedrock, CockroachDB and Secrets
 * Manager exactly as the API does, and a second role would drift from the first.
 */
resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${var.name_prefix}-${var.environment}-ide-worker"
  retention_in_days = 14
  tags              = var.tags
}

resource "aws_lambda_function" "worker" {
  function_name    = "${var.name_prefix}-${var.environment}-ide-worker"
  role             = aws_iam_role.lambda.arn
  handler          = var.worker_handler
  runtime          = var.runtime
  timeout          = var.worker_timeout
  memory_size      = var.worker_memory_mb
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
    aws_cloudwatch_log_group.worker,
    aws_iam_role_policy.lambda,
  ]

  tags = var.tags
}

/**
 * The API function may invoke the worker, and nothing else.
 *
 * Scoped to the worker's ARN rather than `*`: this role already carries Bedrock
 * and Secrets Manager access, and a wildcard invoke permission on top of that
 * would let a compromised API path reach every function in the account.
 */
data "aws_iam_policy_document" "invoke_worker" {
  statement {
    sid       = "InvokeWorker"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.worker.arn]
  }
}

resource "aws_iam_role_policy" "invoke_worker" {
  name   = "${var.name_prefix}-${var.environment}-ide-invoke-worker"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.invoke_worker.json
}

output "worker_function_name" {
  value = aws_lambda_function.worker.function_name
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
