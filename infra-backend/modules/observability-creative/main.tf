# WalkCroach Creative observability (Phase H4 / plan §9.3)
#
# - CloudWatch dashboard for EMF metrics emitted by agent-harness
#   (Namespace WalkCroach/Creative)
# - AWS Budget on Amazon Bedrock monthly spend with optional SNS alarm

variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "bedrock_monthly_budget_usd" {
  type        = string
  description = "Monthly AWS Budget limit (USD) for Amazon Bedrock cost filter"
  default     = "150"
}

variable "budget_alert_email" {
  type        = string
  description = "Optional email for budget notifications (empty = SNS topic only, no subscription)"
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}

locals {
  metric_namespace = "WalkCroach/Creative"
  metric_names = [
    "ImageGenCount",
    "VideoJobSuccess",
    "VideoJobFail",
    "CreativeQuotaDenied",
    "ProInvokeCount",
  ]
}

resource "aws_sns_topic" "creative_budget" {
  name = "${var.name_prefix}-creative-budget"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "creative_budget_email" {
  count     = var.budget_alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.creative_budget.arn
  protocol  = "email"
  endpoint  = var.budget_alert_email
}

resource "aws_budgets_budget" "bedrock_creative" {
  name         = "${var.name_prefix}-bedrock"
  budget_type  = "COST"
  limit_amount = var.bedrock_monthly_budget_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name = "Service"
    values = [
      "Amazon Bedrock",
    ]
  }

  cost_types {
    include_credit             = false
    include_discount           = true
    include_other_subscription = true
    include_recurring          = true
    include_refund             = false
    include_subscription       = true
    include_support            = false
    include_tax                = true
    include_upfront            = true
    use_amortized              = false
    use_blended                = false
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 80
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.creative_budget.arn]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.creative_budget.arn]
  }

  tags = var.tags
}

resource "aws_cloudwatch_dashboard" "creative" {
  dashboard_name = "${var.name_prefix}-creative"

  dashboard_body = jsonencode({
    widgets = concat(
      [
        {
          type   = "text"
          x      = 0
          y      = 0
          width  = 24
          height = 2
          properties = {
            markdown = "# WalkCroach Creative metrics (`${var.environment}`)\nEMF namespace `${local.metric_namespace}`. Hard caps: images ≤3/24h, video ≤1/72h."
          }
        }
      ],
      [
        for i, name in local.metric_names : {
          type   = "metric"
          x      = (i % 3) * 8
          y      = 2 + floor(i / 3) * 6
          width  = 8
          height = 6
          properties = {
            title   = name
            region  = data.aws_region.current.region
            view    = "timeSeries"
            stacked = false
            period  = 300
            stat    = "Sum"
            metrics = [
              [local.metric_namespace, name, "Environment", var.environment]
            ]
          }
        }
      ]
    )
  })
}

data "aws_region" "current" {}

output "dashboard_name" {
  value = aws_cloudwatch_dashboard.creative.dashboard_name
}

output "budget_name" {
  value = aws_budgets_budget.bedrock_creative.name
}

output "budget_sns_topic_arn" {
  value = aws_sns_topic.creative_budget.arn
}
