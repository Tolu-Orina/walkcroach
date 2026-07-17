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

variable "bedrock_region" {
  type        = string
  description = "Region for Bedrock API calls (may match aws_region)"
  default     = "eu-west-2"
}

variable "nova_model_id" {
  type        = string
  description = "Bedrock Nova model ID"
  default     = "eu.amazon.nova-2-lite-v1:0"
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
