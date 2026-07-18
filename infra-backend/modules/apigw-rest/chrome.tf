# /chrome/* → Chrome BFF Lambda (auth enforced in Lambda so anon device sessions work).
# Sibling to root {proxy+}; static /chrome takes precedence for /chrome/... requests.

variable "chrome_lambda_function_name" {
  type = string
}

variable "chrome_lambda_function_arn" {
  type = string
}

locals {
  chrome_streaming_uri = "arn:aws:apigateway:${var.aws_region}:lambda:path/2021-11-15/functions/${var.chrome_lambda_function_arn}/response-streaming-invocations"
}

resource "aws_api_gateway_resource" "chrome" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "chrome"
}

resource "aws_api_gateway_resource" "chrome_proxy" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.chrome.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "chrome_proxy_any" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.chrome_proxy.id
  http_method   = "ANY"
  authorization = "NONE"

  request_parameters = {
    "method.request.path.proxy" = true
  }
}

resource "aws_api_gateway_integration" "chrome_proxy_any" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.chrome_proxy.id
  http_method             = aws_api_gateway_method.chrome_proxy_any.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.chrome_streaming_uri
  response_transfer_mode  = "STREAM"
}

resource "aws_api_gateway_method" "chrome_proxy_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.chrome_proxy.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "chrome_proxy_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.chrome_proxy.id
  http_method = aws_api_gateway_method.chrome_proxy_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 204}"
  }

  depends_on = [aws_api_gateway_method.chrome_proxy_options]
}

resource "aws_api_gateway_method_response" "chrome_proxy_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.chrome_proxy.id
  http_method = aws_api_gateway_method.chrome_proxy_options.http_method
  status_code = "204"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }

  depends_on = [aws_api_gateway_method.chrome_proxy_options]
}

resource "aws_api_gateway_integration_response" "chrome_proxy_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.chrome_proxy.id
  http_method = aws_api_gateway_method.chrome_proxy_options.http_method
  status_code = aws_api_gateway_method_response.chrome_proxy_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'content-type,accept,authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [
    aws_api_gateway_integration.chrome_proxy_options,
    aws_api_gateway_method_response.chrome_proxy_options,
  ]
}

# Also allow OPTIONS on /chrome itself (some clients probe the parent).
resource "aws_api_gateway_method" "chrome_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.chrome.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "chrome_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.chrome.id
  http_method = aws_api_gateway_method.chrome_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 204}"
  }

  depends_on = [aws_api_gateway_method.chrome_options]
}

resource "aws_api_gateway_method_response" "chrome_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.chrome.id
  http_method = aws_api_gateway_method.chrome_options.http_method
  status_code = "204"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }

  depends_on = [aws_api_gateway_method.chrome_options]
}

resource "aws_api_gateway_integration_response" "chrome_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.chrome.id
  http_method = aws_api_gateway_method.chrome_options.http_method
  status_code = aws_api_gateway_method_response.chrome_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'content-type,accept,authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [
    aws_api_gateway_integration.chrome_options,
    aws_api_gateway_method_response.chrome_options,
  ]
}

resource "aws_lambda_permission" "apigw_chrome" {
  statement_id  = "AllowAPIGatewayInvokeChrome"
  action        = "lambda:InvokeFunction"
  function_name = var.chrome_lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}
