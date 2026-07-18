# /ide/* → IDE BFF Lambda (Cognito JWT enforced in Lambda; ALLOW_DEV_AUTH for local).
# Sibling to /chrome/{proxy+}.

variable "ide_lambda_function_name" {
  type = string
}

variable "ide_lambda_function_arn" {
  type = string
}

locals {
  ide_streaming_uri = "arn:aws:apigateway:${var.aws_region}:lambda:path/2021-11-15/functions/${var.ide_lambda_function_arn}/response-streaming-invocations"
}

resource "aws_api_gateway_resource" "ide" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "ide"
}

resource "aws_api_gateway_resource" "ide_proxy" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.ide.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "ide_proxy_any" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ide_proxy.id
  http_method   = "ANY"
  authorization = "NONE"

  request_parameters = {
    "method.request.path.proxy" = true
  }
}

resource "aws_api_gateway_integration" "ide_proxy_any" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.ide_proxy.id
  http_method             = aws_api_gateway_method.ide_proxy_any.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.ide_streaming_uri
  response_transfer_mode  = "STREAM"
}

resource "aws_api_gateway_method" "ide_proxy_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ide_proxy.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "ide_proxy_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ide_proxy.id
  http_method = aws_api_gateway_method.ide_proxy_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 204}"
  }

  depends_on = [aws_api_gateway_method.ide_proxy_options]
}

resource "aws_api_gateway_method_response" "ide_proxy_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ide_proxy.id
  http_method = aws_api_gateway_method.ide_proxy_options.http_method
  status_code = "204"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }

  depends_on = [aws_api_gateway_method.ide_proxy_options]
}

resource "aws_api_gateway_integration_response" "ide_proxy_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ide_proxy.id
  http_method = aws_api_gateway_method.ide_proxy_options.http_method
  status_code = aws_api_gateway_method_response.ide_proxy_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'content-type,accept,authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [
    aws_api_gateway_integration.ide_proxy_options,
    aws_api_gateway_method_response.ide_proxy_options,
  ]
}

resource "aws_api_gateway_method" "ide_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.ide.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "ide_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ide.id
  http_method = aws_api_gateway_method.ide_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 204}"
  }

  depends_on = [aws_api_gateway_method.ide_options]
}

resource "aws_api_gateway_method_response" "ide_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ide.id
  http_method = aws_api_gateway_method.ide_options.http_method
  status_code = "204"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }

  depends_on = [aws_api_gateway_method.ide_options]
}

resource "aws_api_gateway_integration_response" "ide_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.ide.id
  http_method = aws_api_gateway_method.ide_options.http_method
  status_code = aws_api_gateway_method_response.ide_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'content-type,accept,authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [
    aws_api_gateway_integration.ide_options,
    aws_api_gateway_method_response.ide_options,
  ]
}

resource "aws_lambda_permission" "apigw_ide" {
  statement_id  = "AllowAPIGatewayInvokeIde"
  action        = "lambda:InvokeFunction"
  function_name = var.ide_lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}
