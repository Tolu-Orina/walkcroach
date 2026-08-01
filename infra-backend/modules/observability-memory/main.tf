# WalkCroach memory-layer observability
#
# Consumes the `WalkCroach/Memory` EMF metrics emitted by
# agent-harness/src/memory-metrics.ts. Until this module existed the metrics
# were written and nothing read them, which is the same failure mode as the
# vector indexes: present, plausible, and doing no work.
#
# CockroachDB is the product's memory layer, so "is recall working" is the
# closest thing this system has to a health check. It is deliberately alarmed
# more tightly than the creative subsystem next door.

variable "name_prefix" {
  type = string
}

variable "environment" {
  type = string
}

variable "alarm_sns_topic_arn" {
  type        = string
  description = "Existing SNS topic for alarm actions. Empty creates a dedicated one."
  default     = ""
}

variable "alarm_email" {
  type        = string
  description = "Optional email subscription when this module creates its own topic"
  default     = ""
}

variable "recall_latency_alarm_ms" {
  type        = number
  description = "p95 recall latency (embed + vector search) that should page someone"
  default     = 3000
}

variable "tags" {
  type    = map(string)
  default = {}
}

data "aws_region" "current" {}

locals {
  ns = "WalkCroach/Memory"

  create_topic = var.alarm_sns_topic_arn == ""
  topic_arn    = local.create_topic ? aws_sns_topic.memory[0].arn : var.alarm_sns_topic_arn

  surfaces = ["web", "chrome", "ide", "cli"]
}

resource "aws_sns_topic" "memory" {
  count = local.create_topic ? 1 : 0
  name  = "${var.name_prefix}-memory-alarms"
  tags  = var.tags
}

resource "aws_sns_topic_subscription" "memory_email" {
  count     = local.create_topic && var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.memory[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# ---------------------------------------------------------------------------
# Alarms
# ---------------------------------------------------------------------------

/**
 * Embedding failures. Titan being unreachable means NOTHING can be written to
 * or recalled from memory — every write path calls embedText first. This is the
 * highest-signal alarm in the system and deliberately has a threshold of one.
 */
resource "aws_cloudwatch_metric_alarm" "embed_failure" {
  alarm_name          = "${var.name_prefix}-memory-embed-failure"
  alarm_description   = "Titan embedding calls are failing. Memory writes and recall are both blocked — check Bedrock availability and credentials in ${var.environment}."
  namespace           = local.ns
  metric_name         = "EmbedFailure"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  # Absent data is the normal state: no failures means no datapoints at all.
  treat_missing_data = "notBreaching"
  dimensions         = { Environment = var.environment }
  alarm_actions      = [local.topic_arn]
  ok_actions         = [local.topic_arn]
  tags               = var.tags
}

/**
 * Recall returning nothing, repeatedly.
 *
 * A single empty recall is ordinary — a brand-new project has no memories yet.
 * A sustained run of them is the signature of the failure this product cannot
 * detect any other way: recall that "works", returns 200, and silently finds
 * nothing, because an index went missing, a migration half-applied, or a tenant
 * filter stopped matching. Correctness testing does not catch it; this does.
 *
 * Three consecutive 5-minute periods, so a quiet afternoon does not page.
 */
resource "aws_cloudwatch_metric_alarm" "recall_empty_sustained" {
  alarm_name          = "${var.name_prefix}-memory-recall-empty"
  alarm_description   = "Every recall has returned zero hits for 15 minutes in ${var.environment}. Expected on a new project; otherwise suspect a missing vector index, an unapplied migration, or a broken tenant filter."
  namespace           = local.ns
  metric_name         = "RecallEmpty"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { Environment = var.environment }
  alarm_actions       = [local.topic_arn]
  tags                = var.tags
}

/**
 * Recall latency. Catches the vector index silently not being used — an exact
 * scan stays correct and merely gets slower as rows accumulate, so nothing else
 * in the system would notice.
 */
resource "aws_cloudwatch_metric_alarm" "recall_latency" {
  alarm_name          = "${var.name_prefix}-memory-recall-latency"
  alarm_description   = "p95 recall latency above ${var.recall_latency_alarm_ms}ms in ${var.environment}. Suspect the vector index is not being used — an exact scan is correct but degrades with row count."
  namespace           = local.ns
  metric_name         = "RecallLatencyMs"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = var.recall_latency_alarm_ms
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { Environment = var.environment }
  alarm_actions       = [local.topic_arn]
  tags                = var.tags
}

# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "memory" {
  dashboard_name = "${var.name_prefix}-memory"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 3
        properties = {
          markdown = join("\n", [
            "# WalkCroach memory layer (`${var.environment}`)",
            "EMF namespace `${local.ns}`, emitted by `agent-harness/src/memory-metrics.ts`.",
            "CockroachDB is the memory layer for every surface — **RecallEmpty** and **EmbedFailure** are the two panels that matter."
          ])
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 3
        width  = 12
        height = 6
        properties = {
          title  = "Recall latency (embed + vector search)"
          region = data.aws_region.current.region
          view   = "timeSeries"
          period = 300
          # Median and p95 together: a gap between them is the signature of a
          # subset of tenants falling off the index.
          metrics = [
            [local.ns, "RecallLatencyMs", "Environment", var.environment, { stat = "p50", label = "p50" }],
            ["...", { stat = "p95", label = "p95" }],
            ["...", { stat = "Maximum", label = "max" }]
          ]
          yAxis = { left = { label = "ms", showUnits = false } }
          annotations = {
            horizontal = [{
              label = "alarm"
              value = var.recall_latency_alarm_ms
            }]
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 3
        width  = 12
        height = 6
        properties = {
          title   = "Recall hits vs empty recalls"
          region  = data.aws_region.current.region
          view    = "timeSeries"
          period  = 300
          stacked = false
          metrics = [
            [local.ns, "RecallHits", "Environment", var.environment, { stat = "Sum", label = "hits returned" }],
            [local.ns, "RecallEmpty", "Environment", var.environment, { stat = "Sum", label = "empty recalls" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 9
        width  = 8
        height = 6
        properties = {
          title  = "Memory writes and supersedes"
          region = data.aws_region.current.region
          view   = "timeSeries"
          period = 300
          # Supersedes trending toward writes means the threshold is too loose
          # and memory is being retired faster than it accumulates.
          metrics = [
            [local.ns, "MemoryWrite", "Environment", var.environment, { stat = "Sum" }],
            [local.ns, "MemorySuperseded", "Environment", var.environment, { stat = "Sum" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 9
        width  = 8
        height = 6
        properties = {
          title  = "Embedding failures"
          region = data.aws_region.current.region
          view   = "timeSeries"
          period = 300
          metrics = [
            [local.ns, "EmbedFailure", "Environment", var.environment, { stat = "Sum" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 9
        width  = 8
        height = 6
        properties = {
          title  = "Recall by surface"
          region = data.aws_region.current.region
          view   = "timeSeries"
          period = 300
          # The cross-surface claim, as a graph: if one surface never appears
          # here, its memory integration is not actually running.
          metrics = [
            for s in local.surfaces :
            [local.ns, "RecallHits", "Environment", var.environment, "Surface", s, { stat = "Sum", label = s }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 15
        width  = 24
        height = 6
        properties = {
          title  = "Top-hit cosine distance (x1000) — recall quality"
          region = data.aws_region.current.region
          view   = "timeSeries"
          period = 300
          # Rising distance means the nearest match is getting further away:
          # either memory is drifting from what users ask, or ANN recall quality
          # has degraded. Neither shows up as an error.
          metrics = [
            [local.ns, "RecallTopDistanceMilli", "Environment", var.environment, { stat = "p50", label = "p50" }],
            ["...", { stat = "p90", label = "p90" }]
          ]
        }
      }
    ]
  })
}

output "dashboard_name" {
  value = aws_cloudwatch_dashboard.memory.dashboard_name
}

output "alarm_topic_arn" {
  value = local.topic_arn
}
