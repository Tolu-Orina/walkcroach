variable "cognito_user_pool_arn" {
  type        = string
  description = "Cognito user pool ARN for JWT authorizer"
  default     = ""
}

variable "enable_cognito_authorizer" {
  type        = bool
  description = "Require Cognito JWT at API Gateway (prod)"
  default     = false
}

locals {
  protected_authorization = var.enable_cognito_authorizer ? "COGNITO_USER_POOLS" : "NONE"
  protected_authorizer_id = var.enable_cognito_authorizer ? aws_api_gateway_authorizer.cognito[0].id : null
}

resource "aws_api_gateway_authorizer" "cognito" {
  count = var.enable_cognito_authorizer ? 1 : 0

  name          = "${var.name_prefix}-${var.environment}-cognito"
  type          = "COGNITO_USER_POOLS"
  rest_api_id   = aws_api_gateway_rest_api.this.id
  provider_arns = [var.cognito_user_pool_arn]
}
