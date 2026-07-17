output "web_bucket" {
  value = module.s3.bucket_id
}

output "cloudfront_distribution_id" {
  value = module.cloudfront.distribution_id
}

output "cloudfront_domain_name" {
  value = module.cloudfront.domain_name
}

output "cloudfront_url" {
  description = "Primary SPA URL (custom domain when configured)"
  value       = module.cloudfront.url
}

output "app_domain" {
  value = var.domain_name != "" ? var.domain_name : module.cloudfront.domain_name
}

output "api_url" {
  description = "Backend API URL (from SSM, set by infra-backend deploy)"
  # Public API Gateway URL — must be readable in terraform output -json for web CI
  value = nonsensitive(data.aws_ssm_parameter.backend_api_url.value)
}
