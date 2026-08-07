# Public SDK surface → IDE Lambda (Phase P0.1).
#
# Stage name is already `v1`, so invoke_url is `…/v1` and these resources appear as:
#   GET  {invoke_url}/keys
#   POST {invoke_url}/memory/recall
#   GET  {invoke_url}/sdk-health
# etc.
#
# `/health` stays on the *agent* Lambda (smoke / deployed-surfaces tests). SDK
# liveness+capabilities use `/sdk-health` on the shared gateway; the ide local
# server still serves GET /v1/health (and /v1/sdk-health as an alias).

locals {
  # Roots that need BOTH a bare resource (list/create) and {proxy+} (nested paths).
  sdk_proxied_roots = toset(["keys", "memory", "content", "runs"])
}

# ── /sdk-health → ide (unauthenticated capability probe) ───────────────────

resource "aws_api_gateway_resource" "sdk_health" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "sdk-health"
}

resource "aws_api_gateway_method" "sdk_health_get" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.sdk_health.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sdk_health_get" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.sdk_health.id
  http_method             = aws_api_gateway_method.sdk_health_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.ide_streaming_uri
  response_transfer_mode  = "STREAM"
}

resource "aws_api_gateway_method" "sdk_health_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.sdk_health.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sdk_health_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.sdk_health.id
  http_method = aws_api_gateway_method.sdk_health_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 204}"
  }

  depends_on = [aws_api_gateway_method.sdk_health_options]
}

resource "aws_api_gateway_method_response" "sdk_health_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.sdk_health.id
  http_method = aws_api_gateway_method.sdk_health_options.http_method
  status_code = "204"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }

  depends_on = [aws_api_gateway_method.sdk_health_options]
}

resource "aws_api_gateway_integration_response" "sdk_health_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.sdk_health.id
  http_method = aws_api_gateway_method.sdk_health_options.http_method
  status_code = aws_api_gateway_method_response.sdk_health_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'content-type,accept,authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [
    aws_api_gateway_integration.sdk_health_options,
    aws_api_gateway_method_response.sdk_health_options,
  ]
}

# ── /keys|/memory|/content|/runs (+ {proxy+}) → ide ────────────────────────

resource "aws_api_gateway_resource" "sdk_root" {
  for_each = local.sdk_proxied_roots

  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = each.key
}

resource "aws_api_gateway_resource" "sdk_proxy" {
  for_each = local.sdk_proxied_roots

  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.sdk_root[each.key].id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "sdk_root_any" {
  for_each = local.sdk_proxied_roots

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.sdk_root[each.key].id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sdk_root_any" {
  for_each = local.sdk_proxied_roots

  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.sdk_root[each.key].id
  http_method             = aws_api_gateway_method.sdk_root_any[each.key].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.ide_streaming_uri
  response_transfer_mode  = "STREAM"
}

resource "aws_api_gateway_method" "sdk_proxy_any" {
  for_each = local.sdk_proxied_roots

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.sdk_proxy[each.key].id
  http_method   = "ANY"
  authorization = "NONE"

  request_parameters = {
    "method.request.path.proxy" = true
  }
}

resource "aws_api_gateway_integration" "sdk_proxy_any" {
  for_each = local.sdk_proxied_roots

  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.sdk_proxy[each.key].id
  http_method             = aws_api_gateway_method.sdk_proxy_any[each.key].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = local.ide_streaming_uri
  response_transfer_mode  = "STREAM"
}

resource "aws_api_gateway_method" "sdk_root_options" {
  for_each = local.sdk_proxied_roots

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.sdk_root[each.key].id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sdk_root_options" {
  for_each = local.sdk_proxied_roots

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.sdk_root[each.key].id
  http_method = aws_api_gateway_method.sdk_root_options[each.key].http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 204}"
  }

  depends_on = [aws_api_gateway_method.sdk_root_options]
}

resource "aws_api_gateway_method_response" "sdk_root_options" {
  for_each = local.sdk_proxied_roots

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.sdk_root[each.key].id
  http_method = aws_api_gateway_method.sdk_root_options[each.key].http_method
  status_code = "204"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }

  depends_on = [aws_api_gateway_method.sdk_root_options]
}

resource "aws_api_gateway_integration_response" "sdk_root_options" {
  for_each = local.sdk_proxied_roots

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.sdk_root[each.key].id
  http_method = aws_api_gateway_method.sdk_root_options[each.key].http_method
  status_code = aws_api_gateway_method_response.sdk_root_options[each.key].status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'content-type,accept,authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [
    aws_api_gateway_integration.sdk_root_options,
    aws_api_gateway_method_response.sdk_root_options,
  ]
}

resource "aws_api_gateway_method" "sdk_proxy_options" {
  for_each = local.sdk_proxied_roots

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.sdk_proxy[each.key].id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sdk_proxy_options" {
  for_each = local.sdk_proxied_roots

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.sdk_proxy[each.key].id
  http_method = aws_api_gateway_method.sdk_proxy_options[each.key].http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 204}"
  }

  depends_on = [aws_api_gateway_method.sdk_proxy_options]
}

resource "aws_api_gateway_method_response" "sdk_proxy_options" {
  for_each = local.sdk_proxied_roots

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.sdk_proxy[each.key].id
  http_method = aws_api_gateway_method.sdk_proxy_options[each.key].http_method
  status_code = "204"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }

  depends_on = [aws_api_gateway_method.sdk_proxy_options]
}

resource "aws_api_gateway_integration_response" "sdk_proxy_options" {
  for_each = local.sdk_proxied_roots

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.sdk_proxy[each.key].id
  http_method = aws_api_gateway_method.sdk_proxy_options[each.key].http_method
  status_code = aws_api_gateway_method_response.sdk_proxy_options[each.key].status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'content-type,accept,authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [
    aws_api_gateway_integration.sdk_proxy_options,
    aws_api_gateway_method_response.sdk_proxy_options,
  ]
}
