variable "cors_allow_origin" {
  type        = string
  description = "Access-Control-Allow-Origin for API Gateway error responses"
  default     = "*"
}

locals {
  cors_allow_origin = var.cors_allow_origin != "" ? var.cors_allow_origin : "*"
  cors_headers = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${local.cors_allow_origin}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'content-type,accept,authorization'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
  }
}

# Cognito authorizer and missing-method errors omit CORS unless gateway responses add them.
resource "aws_api_gateway_gateway_response" "unauthorized" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  response_type = "UNAUTHORIZED"
  status_code   = "401"

  response_parameters = local.cors_headers

  response_templates = {
    "application/json" = "{\"message\":$context.error.messageString}"
  }
}

resource "aws_api_gateway_gateway_response" "access_denied" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  response_type = "ACCESS_DENIED"
  status_code   = "403"

  response_parameters = local.cors_headers

  response_templates = {
    "application/json" = "{\"message\":$context.error.messageString}"
  }
}

resource "aws_api_gateway_gateway_response" "default_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  response_type = "DEFAULT_4XX"

  response_parameters = local.cors_headers

  response_templates = {
    "application/json" = "{\"message\":$context.error.messageString}"
  }
}

resource "aws_api_gateway_gateway_response" "default_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  response_type = "DEFAULT_5XX"

  response_parameters = local.cors_headers

  response_templates = {
    "application/json" = "{\"message\":$context.error.messageString}"
  }
}
