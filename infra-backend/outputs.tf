output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "cognito_client_id" {
  value = module.cognito.client_id
}

output "cognito_region" {
  value = module.cognito.region
}

output "api_invoke_url" {
  value = module.apigw.invoke_url
}

output "lambda_function_name" {
  value = module.lambda_agent.function_name
}

output "apps_deploy_url_pattern" {
  value = module.apps_hosting.deploy_url_pattern
}

output "apps_bucket" {
  value = module.apps_hosting.apps_bucket_id
}

output "creative_ecr_repository_url" {
  description = "ECR repository the creative Lambda image is pushed to. Created unconditionally, before and independently of the function that consumes it — so scripts/push-creative-image.sh can resolve it on a stack where creatives are still off."
  value       = module.lambda_creative.ecr_repository_url
}

output "creative_lambda_name" {
  description = "Creative Lambda function name, empty until an image tag is set."
  value       = module.lambda_creative.function_name
}
