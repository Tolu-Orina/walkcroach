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
