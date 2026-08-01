locals {
  name_prefix = var.project_name
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }

  # Built by CI / local package step from modules/lambda-agent/codes
  lambda_zip = var.lambda_zip_path != "" ? var.lambda_zip_path : "${path.module}/modules/lambda-agent/.build/lambda.zip"
  # Built by npm run package:lambda:chrome
  chrome_lambda_zip = var.chrome_lambda_zip_path != "" ? var.chrome_lambda_zip_path : "${path.module}/modules/lambda-chrome/.build/lambda.zip"
  # Built by npm run package:lambda:ide
  ide_lambda_zip = var.ide_lambda_zip_path != "" ? var.ide_lambda_zip_path : "${path.module}/modules/lambda-ide/.build/lambda.zip"
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

  name_prefix = local.name_prefix
  environment = var.environment
  tags        = local.tags
}

module "bedrock_guardrails" {
  source = "./modules/bedrock-guardrails"

  name_prefix = local.name_prefix
  environment = var.environment
  tags        = local.tags
}

module "lambda_agent" {
  source = "./modules/lambda-agent"

  name_prefix                = local.name_prefix
  environment                = var.environment
  zip_path                   = local.lambda_zip
  handler                    = var.lambda_handler
  runtime                    = var.lambda_runtime
  timeout                    = var.lambda_timeout
  memory_mb                  = var.lambda_memory_mb
  bedrock_region             = var.bedrock_region
  nova_model_id              = var.nova_model_id
  nova_canvas_model_id       = var.nova_canvas_model_id
  nova_pro_model_id          = var.nova_pro_model_id
  titan_embed_model_id       = var.titan_embed_model_id
  bedrock_guardrail_id       = module.bedrock_guardrails.guardrail_id
  bedrock_guardrail_version  = module.bedrock_guardrails.guardrail_version
  creative_guardrail_id      = module.bedrock_guardrails.creative_guardrail_id
  creative_guardrail_version = module.bedrock_guardrails.creative_guardrail_version
  runtime_secret_arn         = module.secrets.runtime_secret_arn
  artefacts_bucket_arn       = module.artefacts.bucket_arn
  artefacts_bucket_name      = module.artefacts.bucket_id
  apps_bucket_arn            = module.apps_hosting.apps_bucket_arn
  apps_bucket_name           = module.apps_hosting.apps_bucket_id
  apps_wildcard_domain       = module.apps_hosting.apps_wildcard_domain
  apps_cf_domain             = module.apps_hosting.cloudfront_domain_name
  codebuild_project          = module.apps_hosting.codebuild_project_name
  cognito_user_pool_id       = module.cognito.user_pool_id
  cognito_client_id          = module.cognito.client_id
  allow_dev_auth             = var.allow_dev_auth
  cors_allow_origin          = var.web_app_url != "" ? var.web_app_url : "*"
  web_app_url                = var.web_app_url
  allow_github_pat           = var.allow_github_pat
  github_ssm_prefix          = var.github_ssm_prefix
  creative_lambda_arn        = module.lambda_creative.function_arn
  creative_lambda_name       = module.lambda_creative.function_name
  video_state_machine_arn    = module.stepfunctions_video.state_machine_arn
  tags                       = local.tags
}

module "lambda_creative" {
  source = "./modules/lambda-creative"

  name_prefix           = local.name_prefix
  environment           = var.environment
  artefacts_bucket_arn  = module.artefacts.bucket_arn
  artefacts_bucket_name = module.artefacts.bucket_id
  enabled               = var.creative_lambda_enabled
  image_uri             = var.creative_lambda_image_uri
  image_tag             = var.creative_lambda_image_tag
  tags                  = local.tags
}

module "stepfunctions_video" {
  source = "./modules/stepfunctions-video"

  name_prefix = local.name_prefix
  # The creative Lambda IS the video worker: its handler already routes
  # `action: "compose_video"` (modules/lambda-creative/codes/src/handler.py), and
  # being a container function invoked directly it is exactly the non-streaming
  # target the state machine needs. There was never a second function to publish.
  #
  # `function_arn` is "" while the creative Lambda does not exist, so the state
  # machine stays skipped until an image is pushed and then appears with it —
  # one value (creative_lambda_image_tag) brings both online, and neither can be
  # half-configured.
  video_worker_lambda_arn = module.lambda_creative.function_arn
  # Decided from variables, not from the ARN above: `count` cannot depend on a
  # value that is unknown until apply, and on the first run that creates the
  # creative Lambda its ARN is exactly that.
  enabled = var.creative_lambda_enabled
  tags    = local.tags
}

module "lambda_chrome" {
  source = "./modules/lambda-chrome"

  name_prefix          = local.name_prefix
  environment          = var.environment
  zip_path             = local.chrome_lambda_zip
  handler              = var.lambda_handler
  runtime              = var.lambda_runtime
  timeout              = var.chrome_lambda_timeout
  memory_mb            = var.chrome_lambda_memory_mb
  bedrock_region       = var.bedrock_region
  nova_model_id        = var.nova_model_id
  titan_embed_model_id = var.titan_embed_model_id
  runtime_secret_arn   = module.secrets.runtime_secret_arn
  cognito_user_pool_id = module.cognito.user_pool_id
  cognito_client_id    = module.cognito.client_id
  allow_dev_auth       = var.allow_dev_auth
  cors_allow_origin    = var.web_app_url != "" ? var.web_app_url : "*"
  web_app_url          = var.web_app_url
  tags                 = local.tags
}

module "lambda_ide" {
  source = "./modules/lambda-ide"

  name_prefix          = local.name_prefix
  environment          = var.environment
  zip_path             = local.ide_lambda_zip
  handler              = var.lambda_handler
  runtime              = var.lambda_runtime
  timeout              = var.ide_lambda_timeout
  memory_mb            = var.ide_lambda_memory_mb
  bedrock_region       = var.bedrock_region
  nova_model_id        = var.nova_model_id
  titan_embed_model_id = var.titan_embed_model_id
  runtime_secret_arn   = module.secrets.runtime_secret_arn
  cognito_user_pool_id = module.cognito.user_pool_id
  cognito_client_id    = module.cognito.client_id
  allow_dev_auth       = var.allow_dev_auth
  cors_allow_origin    = var.web_app_url != "" ? var.web_app_url : "*"
  tags                 = local.tags
}

module "apigw" {
  source = "./modules/apigw-rest"

  name_prefix                 = local.name_prefix
  environment                 = var.environment
  stage_name                  = var.api_stage_name
  aws_region                  = var.aws_region
  lambda_function_name        = module.lambda_agent.function_name
  lambda_function_arn         = module.lambda_agent.function_arn
  chrome_lambda_function_name = module.lambda_chrome.function_name
  chrome_lambda_function_arn  = module.lambda_chrome.function_arn
  ide_lambda_function_name    = module.lambda_ide.function_name
  ide_lambda_function_arn     = module.lambda_ide.function_arn
  cognito_user_pool_arn       = module.cognito.user_pool_arn
  enable_cognito_authorizer   = var.enable_apigw_cognito_authorizer
  cors_allow_origin           = var.web_app_url != "" ? var.web_app_url : "*"
  tags                        = local.tags
}

module "ssm" {
  source = "./modules/ssm"

  name_prefix          = local.name_prefix
  environment          = var.environment
  api_url              = module.apigw.invoke_url
  cognito_user_pool_id = module.cognito.user_pool_id
  cognito_client_id    = module.cognito.client_id
  cognito_region       = module.cognito.region
  web_app_url          = var.web_app_url
  tags                 = local.tags
}

module "observability_creative" {
  source = "./modules/observability-creative"

  name_prefix                = local.name_prefix
  environment                = var.environment
  bedrock_monthly_budget_usd = var.bedrock_monthly_budget_usd
  bedrock_budget_alert_usd   = var.bedrock_budget_alert_usd
  budget_alert_email         = var.budget_alert_email
  tags                       = local.tags
}

# Memory-layer observability. Reuses the creative module's SNS topic rather than
# creating a second one — a separate topic would mean a second subscription to
# confirm and a second place to look when something is quiet.
module "observability_memory" {
  source = "./modules/observability-memory"

  name_prefix             = local.name_prefix
  environment             = var.environment
  alarm_sns_topic_arn     = module.observability_creative.budget_sns_topic_arn
  recall_latency_alarm_ms = var.memory_recall_latency_alarm_ms
  tags                    = local.tags
}
