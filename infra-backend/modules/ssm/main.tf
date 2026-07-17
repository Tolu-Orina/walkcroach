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

output "api_url_parameter_name" {
  value = aws_ssm_parameter.api_url.name
}

output "api_url_parameter_arn" {
  value = aws_ssm_parameter.api_url.arn
}
