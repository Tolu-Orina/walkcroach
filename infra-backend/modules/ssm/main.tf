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
  default     = ""
}

variable "cognito_client_id" {
  type        = string
  description = "Cognito app client ID for web SPA"
  default     = ""
}

variable "cognito_hosted_domain" {
  type        = string
  description = "Cognito hosted UI domain (no scheme)"
  default     = ""
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
  count       = var.cognito_user_pool_id != "" ? 1 : 0
  name        = "/${var.name_prefix}/${var.environment}/web/cognito_user_pool_id"
  description = "Cognito user pool ID for WalkCroach web SPA"
  type        = "String"
  value       = var.cognito_user_pool_id
  overwrite   = true
  tags        = var.tags
}

resource "aws_ssm_parameter" "cognito_client_id" {
  count       = var.cognito_client_id != "" ? 1 : 0
  name        = "/${var.name_prefix}/${var.environment}/web/cognito_client_id"
  description = "Cognito app client ID for WalkCroach web SPA"
  type        = "String"
  value       = var.cognito_client_id
  overwrite   = true
  tags        = var.tags
}

resource "aws_ssm_parameter" "cognito_hosted_domain" {
  count       = var.cognito_hosted_domain != "" ? 1 : 0
  name        = "/${var.name_prefix}/${var.environment}/web/cognito_hosted_domain"
  description = "Cognito hosted UI domain for WalkCroach web SPA"
  type        = "String"
  value       = var.cognito_hosted_domain
  overwrite   = true
  tags        = var.tags
}

output "api_url_parameter_name" {
  value = aws_ssm_parameter.api_url.name
}

output "api_url_parameter_arn" {
  value = aws_ssm_parameter.api_url.arn
}
