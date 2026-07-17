variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "api_url" {
  type        = string
  description = "Public API base URL published for the web SPA build"
}

variable "cognito_user_pool_id" {
  type        = string
  description = "Cognito user pool ID for web SPA"
}

variable "cognito_client_id" {
  type        = string
  description = "Cognito app client ID for web SPA"
}

variable "cognito_region" {
  type        = string
  description = "AWS region of the Cognito user pool (for in-app auth API)"
}

variable "tags" {
  type    = map(string)
  default = {}
}

resource "aws_ssm_parameter" "api_url" {
  name        = "/${var.name_prefix}/${var.environment}/web/api_url"
  description = "WalkCroach backend API URL for web Vite builds"
  type        = "String"
  value       = var.api_url
  overwrite   = true
  tags        = var.tags
}

resource "aws_ssm_parameter" "cognito_user_pool_id" {
  name        = "/${var.name_prefix}/${var.environment}/web/cognito_user_pool_id"
  description = "Cognito user pool ID for WalkCroach web SPA"
  type        = "String"
  value       = var.cognito_user_pool_id
  overwrite   = true
  tags        = var.tags
}

resource "aws_ssm_parameter" "cognito_client_id" {
  name        = "/${var.name_prefix}/${var.environment}/web/cognito_client_id"
  description = "Cognito app client ID for WalkCroach web SPA"
  type        = "String"
  value       = var.cognito_client_id
  overwrite   = true
  tags        = var.tags
}

resource "aws_ssm_parameter" "cognito_region" {
  name        = "/${var.name_prefix}/${var.environment}/web/cognito_region"
  description = "Cognito user pool region for WalkCroach in-app auth"
  type        = "String"
  value       = var.cognito_region
  overwrite   = true
  tags        = var.tags
}

output "api_url_parameter_name" {
  value = aws_ssm_parameter.api_url.name
}

output "api_url_parameter_arn" {
  value = aws_ssm_parameter.api_url.arn
}
