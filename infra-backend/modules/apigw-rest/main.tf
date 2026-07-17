variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "stage_name" {
  type = string
}

variable "lambda_function_name" {
  type = string
}

variable "lambda_invoke_arn" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

resource "aws_api_gateway_rest_api" "this" {
  name        = "${var.name_prefix}-${var.environment}-api"
  description = "WalkCroach agent API (REST + response streaming)"

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = var.tags
}

resource "aws_api_gateway_resource" "health" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "health"
}

resource "aws_api_gateway_resource" "projects" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "projects"
}

resource "aws_api_gateway_resource" "sessions" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "sessions"
}

resource "aws_api_gateway_resource" "session_id" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.sessions.id
  path_part   = "{sessionId}"
}

resource "aws_api_gateway_resource" "prompt" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.session_id.id
  path_part   = "prompt"
}

resource "aws_api_gateway_resource" "tool_result" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.session_id.id
  path_part   = "tool-result"
}

locals {
  # Single streamifyResponse Lambda — all routes use response-streaming invocations.
  streaming_uri = replace(
    var.lambda_invoke_arn,
    "/invocations",
    "/response-streaming-invocations",
  )
}

resource "aws_api_gateway_method" "health_get" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.health.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "health_get" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.health.id
  http_method             = aws_api_gateway_method.health_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.streaming_uri
  response_transfer_mode  = "STREAM"
}

resource "aws_api_gateway_method" "projects_post" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.projects.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "projects_post" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.projects.id
  http_method             = aws_api_gateway_method.projects_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.streaming_uri
  response_transfer_mode  = "STREAM"
}

resource "aws_api_gateway_method" "sessions_post" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.sessions.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sessions_post" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.sessions.id
  http_method             = aws_api_gateway_method.sessions_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.streaming_uri
  response_transfer_mode  = "STREAM"
}

resource "aws_api_gateway_method" "session_get" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.session_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "session_get" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.session_id.id
  http_method             = aws_api_gateway_method.session_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.streaming_uri
  response_transfer_mode  = "STREAM"
}

resource "aws_api_gateway_method" "prompt_post" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.prompt.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "prompt_post" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.prompt.id
  http_method             = aws_api_gateway_method.prompt_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.streaming_uri
  response_transfer_mode  = "STREAM"
}

resource "aws_api_gateway_method" "tool_result_post" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.tool_result.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "tool_result_post" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.tool_result.id
  http_method             = aws_api_gateway_method.tool_result_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.streaming_uri
  response_transfer_mode  = "STREAM"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  triggers = {
    redeploy = sha1(jsonencode([
      aws_api_gateway_integration.health_get.id,
      aws_api_gateway_integration.projects_post.id,
      aws_api_gateway_integration.sessions_post.id,
      aws_api_gateway_integration.session_get.id,
      aws_api_gateway_integration.prompt_post.id,
      aws_api_gateway_integration.tool_result_post.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.health_get,
    aws_api_gateway_integration.projects_post,
    aws_api_gateway_integration.sessions_post,
    aws_api_gateway_integration.session_get,
    aws_api_gateway_integration.prompt_post,
    aws_api_gateway_integration.tool_result_post,
  ]
}

resource "aws_api_gateway_stage" "this" {
  deployment_id = aws_api_gateway_deployment.this.id
  rest_api_id   = aws_api_gateway_rest_api.this.id
  stage_name    = var.stage_name
  tags          = var.tags
}

output "rest_api_id" {
  value = aws_api_gateway_rest_api.this.id
}

output "invoke_url" {
  value = aws_api_gateway_stage.this.invoke_url
}

output "execution_arn" {
  value = aws_api_gateway_rest_api.this.execution_arn
}
