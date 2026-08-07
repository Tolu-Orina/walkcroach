variable "aws_region" {
  type        = string
  description = "AWS region for all resources"
  default     = "eu-west-2"
}

variable "environment" {
  type        = string
  description = "Environment name (dev | test | prod)"

  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "environment must be dev, test, or prod."
  }
}

variable "project_name" {
  type        = string
  description = "Project name used in resource naming"
  default     = "walkcroach"
}

variable "lambda_zip_path" {
  type        = string
  description = "Path to Lambda deployment zip. Empty = modules/lambda-agent/.build/lambda.zip"
  default     = ""
}

variable "lambda_handler" {
  type        = string
  description = "Lambda handler"
  default     = "index.handler"
}

variable "lambda_runtime" {
  type        = string
  description = "Lambda runtime"
  default     = "nodejs20.x"
}

variable "lambda_timeout" {
  type        = number
  description = "Lambda timeout seconds (streaming turns can be long)"
  default     = 300
}

variable "lambda_memory_mb" {
  type        = number
  description = "Lambda memory (MB)"
  default     = 1024
}

variable "chrome_lambda_zip_path" {
  type        = string
  description = "Path to Chrome Lambda zip. Empty = modules/lambda-chrome/.build/lambda.zip"
  default     = ""
}

variable "chrome_lambda_timeout" {
  type        = number
  description = "Chrome BFF Lambda timeout seconds"
  default     = 60
}

variable "chrome_lambda_memory_mb" {
  type        = number
  description = "Chrome BFF Lambda memory (MB)"
  default     = 512
}

variable "ide_lambda_zip_path" {
  type        = string
  description = "Path to IDE Lambda zip. Empty = modules/lambda-ide/.build/lambda.zip"
  default     = ""
}

variable "ide_lambda_timeout" {
  type        = number
  description = <<-EOT
    IDE BFF Lambda timeout, seconds — the *request* path only.

    Raised from 60 because a memory recall embeds its query through Bedrock
    first, and a cold Bedrock call plus a CockroachDB round trip left very
    little headroom under load.

    Deliberately NOT raised to Lambda's maximum: long agent runs execute on the
    separate worker function, and a generous timeout here would mean a hung
    request holds a concurrency slot for as long as it takes to notice.
  EOT
  default     = 120
}

variable "ide_worker_lambda_timeout" {
  type        = number
  description = "Async run worker timeout, seconds. 900 is Lambda's maximum and the ceiling on one run."
  default     = 900
}

variable "ide_worker_lambda_memory_mb" {
  type        = number
  description = "Async run worker memory. Holds repository context and the agent transcript."
  default     = 2048
}

variable "ide_lambda_memory_mb" {
  type        = number
  description = "IDE BFF Lambda memory (MB)"
  default     = 512
}

variable "bedrock_region" {
  type        = string
  description = "Region for Bedrock API calls (may match aws_region)"
  default     = "eu-west-2"
}

variable "nova_model_id" {
  type        = string
  description = "Bedrock Nova 2 Lite model ID (text + creative briefs; extended thinking always on)"
  default     = "global.amazon.nova-2-lite-v1:0"
}

variable "nova_canvas_model_id" {
  type        = string
  description = "Bedrock Nova Canvas model ID (image generation)"
  default     = "amazon.nova-canvas-v1:0"
}

variable "creative_lambda_image_uri" {
  type        = string
  description = "Full image URI override for lambda-creative. Prefer creative_lambda_image_tag unless the image lives outside this account's ECR."
  default     = ""
}

variable "creative_lambda_enabled" {
  type        = bool
  description = <<-EOT
    Create the creative Lambda (and, via its ARN, the video state machine).

    Deliberately separate from the image tag: with one value, blanking the tag
    would destroy both silently. With two, an empty tag while this is true is a
    plan-time error, and removing the infrastructure requires setting this false.
  EOT
  default     = false
}

variable "creative_lambda_image_tag" {
  type        = string
  description = <<-EOT
    Tag of an image pushed to the ECR repository this stack creates. Setting it
    creates the creative Lambda, which in turn supplies the video Step Functions
    worker ARN — so creatives and video both come online from this one value.
    Empty keeps both paths on the local/stub fallback.
  EOT
  default     = ""
}

variable "titan_embed_model_id" {
  type        = string
  description = "Bedrock Titan embeddings model ID"
  default     = "amazon.titan-embed-text-v2:0"
}

variable "api_stage_name" {
  type        = string
  description = "API Gateway stage name"
  default     = "v1"
}

variable "hosted_zone_name" {
  type        = string
  description = "Route53 zone for deployed app wildcard and API custom domain (prod)"
  default     = ""
}

variable "api_custom_domain_name" {
  type        = string
  description = "Regional API custom domain (e.g. api.walkcroach.rinegansolutions.com). Empty keeps execute-api only."
  default     = ""
}

variable "apps_wildcard_domain" {
  type        = string
  description = "Base domain for user apps: {slug}.{apps_wildcard_domain}"
  default     = ""
}

variable "web_app_url" {
  type        = string
  description = "Public builder SPA URL (for Cognito OAuth callbacks)"
  default     = ""
}

variable "allow_dev_auth" {
  type        = bool
  description = "Allow Bearer dev:* tokens (disable in prod; prefer false)"
  default     = false
}

variable "enable_apigw_cognito_authorizer" {
  type        = bool
  description = "Enforce Cognito JWT at API Gateway (prod recommended)"
  default     = false
}

variable "allow_github_pat" {
  type        = bool
  description = "Allow legacy GitHub PAT connect in Lambda (disable in prod)"
  default     = true
}

variable "github_ssm_prefix" {
  type        = string
  description = "Override SSM prefix for manually created GitHub App parameters"
  default     = ""
}

variable "bedrock_monthly_budget_usd" {
  type        = string
  description = "Monthly AWS Budget USD limit for Amazon Bedrock"
  default     = "50"
}

variable "bedrock_budget_alert_usd" {
  type        = list(number)
  description = "Absolute USD spend levels that each raise a budget notification"
  default     = [10, 20, 30, 40, 50]
}

variable "budget_alert_email" {
  type        = string
  description = "Phase H4 — optional email subscribed to creative Bedrock budget SNS"
  default     = ""
}

variable "memory_recall_latency_alarm_ms" {
  type        = number
  description = <<-EOT
    p95 memory-recall latency (Titan embed + CockroachDB vector search) above
    which the WalkCroach/Memory alarm fires. Recall degrading is the symptom of
    the vector index silently not being used: an exact scan stays correct and
    merely gets slower as rows accumulate, so nothing else in the system notices.
  EOT
  default     = 3000
}
