locals {
  name_prefix = var.project_name
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }

  cognito_callback_urls = compact([
    var.web_app_url != "" ? "${var.web_app_url}/auth/callback" : "",
    "http://localhost:5173/auth/callback",
  ])
  cognito_logout_urls = compact([
    var.web_app_url != "" ? var.web_app_url : "",
    "http://localhost:5173/",
  ])

  # Built by CI / local package step from modules/lambda-agent/codes
  lambda_zip = var.lambda_zip_path != "" ? var.lambda_zip_path : "${path.module}/modules/lambda-agent/.build/lambda.zip"
}

module "secrets" {
  source      = "./modules/secrets"
  name_prefix = local.name_prefix
  environment = var.environment
}

module "artefacts" {
  source      = "./modules/artefacts"
  name_prefix = local.name_prefix
  environment = var.environment
  tags        = local.tags
}

module "apps_hosting" {
  source = "./modules/apps-hosting"

  providers = {
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix          = local.name_prefix
  environment          = var.environment
  hosted_zone_name     = var.hosted_zone_name
  apps_wildcard_domain = var.apps_wildcard_domain
  tags                 = local.tags
}

module "cognito" {
  source = "./modules/cognito"

  name_prefix       = local.name_prefix
  environment       = var.environment
  spa_callback_urls = local.cognito_callback_urls
  spa_logout_urls   = local.cognito_logout_urls
  tags              = local.tags
}

module "lambda_agent" {
  source = "./modules/lambda-agent"

  name_prefix          = local.name_prefix
  environment          = var.environment
  zip_path             = local.lambda_zip
  handler              = var.lambda_handler
  runtime              = var.lambda_runtime
  timeout              = var.lambda_timeout
  memory_mb            = var.lambda_memory_mb
  bedrock_region       = var.bedrock_region
  nova_model_id        = var.nova_model_id
  titan_embed_model_id = var.titan_embed_model_id
  runtime_secret_arn   = module.secrets.runtime_secret_arn
  artefacts_bucket_arn = module.artefacts.bucket_arn
  artefacts_bucket_name = module.artefacts.bucket_id
  apps_bucket_arn      = module.apps_hosting.apps_bucket_arn
  apps_bucket_name     = module.apps_hosting.apps_bucket_id
  apps_wildcard_domain = module.apps_hosting.apps_wildcard_domain
  apps_cf_domain       = module.apps_hosting.cloudfront_domain_name
  codebuild_project    = module.apps_hosting.codebuild_project_name
  cognito_user_pool_id = module.cognito.user_pool_id
  cognito_client_id    = module.cognito.client_id
  allow_dev_auth       = var.allow_dev_auth
  allow_github_pat     = var.allow_github_pat
  github_ssm_prefix    = var.github_ssm_prefix
  tags                 = local.tags
}

module "apigw" {
  source = "./modules/apigw-rest"

  name_prefix                     = local.name_prefix
  environment                     = var.environment
  stage_name                      = var.api_stage_name
  aws_region                      = var.aws_region
  lambda_function_name            = module.lambda_agent.function_name
  lambda_function_arn             = module.lambda_agent.function_arn
  cognito_user_pool_arn           = module.cognito.user_pool_arn
  enable_cognito_authorizer       = var.enable_apigw_cognito_authorizer
  tags                            = local.tags
}

module "ssm" {
  source = "./modules/ssm"

  name_prefix           = local.name_prefix
  environment           = var.environment
  api_url               = module.apigw.invoke_url
  cognito_user_pool_id  = module.cognito.user_pool_id
  cognito_client_id     = module.cognito.client_id
  cognito_hosted_domain = module.cognito.hosted_ui_domain
  tags                  = local.tags
}
