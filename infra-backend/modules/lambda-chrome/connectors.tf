# Workflow connectors (Phase E) — cross-surface.
#
# The connector platform is shared: Web, Chrome, the IDE and the CLI all read the
# same `connectors` rows and the same Secrets Manager namespace. This file grants
# only what the Chrome BFF needs to participate; the OAuth *app* credentials
# themselves live in the runtime secret, not here.

variable "web_app_url" {
  description = "WalkCroach Web origin. Chrome deep-links here to connect accounts (plan §9.2)."
  type        = string
  default     = ""
}

data "aws_iam_policy_document" "connector_secrets" {
  statement {
    sid = "ConnectorTokens"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
      "secretsmanager:CreateSecret",
      "secretsmanager:DeleteSecret",
      "secretsmanager:DescribeSecret",
    ]
    # Scoped to the connector namespace for this environment only — the Lambda
    # must not be able to read the runtime secret's siblings.
    resources = [
      "arn:aws:secretsmanager:*:*:secret:walkcroach/${var.environment}/connectors/*",
    ]
  }
}

resource "aws_iam_role_policy" "connector_secrets" {
  name   = "${var.name_prefix}-${var.environment}-chrome-connectors"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.connector_secrets.json
}
