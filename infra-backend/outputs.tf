output "api_url" {
  description = "API Gateway invoke URL (also written to SSM)"
  value       = module.apigw.invoke_url
}

output "api_url_ssm_parameter" {
  description = "SSM parameter name for web builds"
  value       = module.ssm.api_url_parameter_name
}

output "lambda_function_name" {
  value = module.lambda_agent.function_name
}

output "lambda_function_arn" {
  value = module.lambda_agent.function_arn
}

output "runtime_secret_arn" {
  value = module.secrets.runtime_secret_arn
}

output "artefacts_bucket" {
  value = module.artefacts.bucket_id
}

output "health_url" {
  value = "${module.apigw.invoke_url}/health"
}
