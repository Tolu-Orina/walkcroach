locals {
  name_prefix       = var.project_name
  use_custom_domain = var.domain_name != ""
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

module "s3" {
  source      = "./modules/s3"
  name_prefix = local.name_prefix
  environment = var.environment
  tags        = local.tags
}

module "acm" {
  count  = local.use_custom_domain ? 1 : 0
  source = "./modules/acm"

  providers = {
    aws.us_east_1 = aws.us_east_1
  }

  domain_name      = var.domain_name
  hosted_zone_name = var.hosted_zone_name
  tags             = local.tags
}

module "cloudfront" {
  source                         = "./modules/cloudfront"
  name_prefix                    = local.name_prefix
  environment                    = var.environment
  s3_bucket_id                   = module.s3.bucket_id
  s3_bucket_regional_domain_name = module.s3.bucket_regional_domain_name
  price_class                    = var.price_class
  aliases                        = local.use_custom_domain ? [var.domain_name] : []
  acm_certificate_arn            = local.use_custom_domain ? module.acm[0].certificate_arn : ""
  tags                           = local.tags
}

module "dns" {
  count  = local.use_custom_domain ? 1 : 0
  source = "./modules/dns"

  domain_name            = var.domain_name
  hosted_zone_id         = module.acm[0].hosted_zone_id
  cloudfront_domain_name = module.cloudfront.domain_name
}
