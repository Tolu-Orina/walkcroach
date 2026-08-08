# Dedicated unauthenticated route for Stripe webhooks.
# The catch-all `{proxy+}` may be Cognito-protected in prod; Stripe cannot send JWTs.
# Signature verification remains in the Lambda (stripe-signature header).

resource "aws_api_gateway_resource" "webhooks" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "webhooks"
}

resource "aws_api_gateway_resource" "webhooks_stripe" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.webhooks.id
  path_part   = "stripe"
}

resource "aws_api_gateway_method" "webhooks_stripe_post" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.webhooks_stripe.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "webhooks_stripe_post" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.webhooks_stripe.id
  http_method             = aws_api_gateway_method.webhooks_stripe_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.streaming_uri
  response_transfer_mode  = "STREAM"
}

resource "aws_api_gateway_method" "webhooks_stripe_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.webhooks_stripe.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "webhooks_stripe_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.webhooks_stripe.id
  http_method = aws_api_gateway_method.webhooks_stripe_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 204}"
  }

  depends_on = [aws_api_gateway_method.webhooks_stripe_options]
}

resource "aws_api_gateway_method_response" "webhooks_stripe_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.webhooks_stripe.id
  http_method = aws_api_gateway_method.webhooks_stripe_options.http_method
  status_code = "204"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }

  depends_on = [aws_api_gateway_method.webhooks_stripe_options]
}

resource "aws_api_gateway_integration_response" "webhooks_stripe_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.webhooks_stripe.id
  http_method = aws_api_gateway_method.webhooks_stripe_options.http_method
  status_code = aws_api_gateway_method_response.webhooks_stripe_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'content-type,accept,authorization,stripe-signature'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${local.cors_allow_origin}'"
  }

  depends_on = [
    aws_api_gateway_integration.webhooks_stripe_options,
    aws_api_gateway_method_response.webhooks_stripe_options,
  ]
}
