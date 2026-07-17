locals {
  name_prefix = var.project_name
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }

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
  tags                 = local.tags
}

module "apigw" {
  source = "./modules/apigw-rest"

  name_prefix          = local.name_prefix
  environment          = var.environment
  stage_name           = var.api_stage_name
  lambda_function_name = module.lambda_agent.function_name
  lambda_invoke_arn    = module.lambda_agent.invoke_arn
  tags                 = local.tags
}

module "ssm" {
  source = "./modules/ssm"

  name_prefix = local.name_prefix
  environment = var.environment
  api_url     = module.apigw.invoke_url
  tags        = local.tags
}
