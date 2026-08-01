# WalkCroach Video Studio — Step Functions (Phase D4 + H2 poll ceiling)
#
# Polls Nova Reel async invoke, then invokes compose on lambda-creative
# via the non-streaming video worker Lambda.
#
# When video_worker_lambda_arn is empty, SFN resources are skipped (count=0).
# The agent then runs an inline poll+compose path (or VIDEO_STUDIO_STUB=1).
# Do not treat an empty ARN as a safe no-op for production video.
#
# Phase H2: pollAttempt caps the Wait→Poll loop (default 40 × 30s ≈ 20 min).

variable "name_prefix" {
  type = string
}

variable "video_worker_lambda_arn" {
  type        = string
  description = "ARN of non-streaming video worker Lambda (empty = skip SFN create)"
  default     = ""
}

variable "max_reel_poll_attempts" {
  type        = number
  description = "Max Wait→Poll iterations before FailJob (H2). 40 × 30s ≈ 20 minutes."
  default     = 40
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "enabled" {
  type        = bool
  description = <<-EOT
    Whether to create the state machine. Must be derivable at PLAN time.

    This exists because `count` cannot depend on a value Terraform only learns
    during apply. When the worker ARN comes from a Lambda created in the same
    run, `var.video_worker_lambda_arn` is unknown at plan time, and deriving
    `count` from it fails with "the count value depends on resource attributes
    that cannot be determined until apply" — on the very first apply that turns
    video on, which is the worst possible moment to discover it.

    The caller therefore passes a decision made from variables (is an image tag
    set?), while the ARN itself is used only where an unknown value is fine.

    null falls back to inferring from the ARN, which is correct when the ARN is
    a literal or comes from a data source.
  EOT
  default     = null
}

locals {
  enabled = var.enabled == null ? var.video_worker_lambda_arn != "" : var.enabled
}

data "aws_iam_policy_document" "sfn_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "video_sfn" {
  count              = local.enabled ? 1 : 0
  name               = "${var.name_prefix}-video-sfn"
  assume_role_policy = data.aws_iam_policy_document.sfn_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "video_sfn" {
  count = local.enabled ? 1 : 0
  statement {
    sid = "InvokeWorker"
    actions = [
      "lambda:InvokeFunction",
    ]
    resources = [var.video_worker_lambda_arn]
  }
  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "logs:PutResourcePolicy",
      "logs:DescribeResourcePolicies",
      "logs:DescribeLogGroups",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "video_sfn" {
  count  = local.enabled ? 1 : 0
  name   = "${var.name_prefix}-video-sfn"
  role   = aws_iam_role.video_sfn[0].id
  policy = data.aws_iam_policy_document.video_sfn[0].json
}

locals {
  definition = jsonencode({
    Comment = "WalkCroach Video Studio — poll Reel then compose (H2 poll ceiling)"
    StartAt = "StartPipeline"
    States = {
      StartPipeline = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.video_worker_lambda_arn
          Payload = {
            "source"    = "sfn-video"
            "step"      = "start"
            "jobId.$"   = "$.jobId"
            "ownerId.$" = "$.ownerId"
          }
        }
        ResultPath = "$.startResult"
        Next       = "WaitReel"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "FailJob"
        }]
      }
      WaitReel = {
        Type    = "Wait"
        Seconds = 30
        Next    = "PollReel"
      }
      PollReel = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.video_worker_lambda_arn
          Payload = {
            "source"    = "sfn-video"
            "step"      = "poll"
            "jobId.$"   = "$.jobId"
            "ownerId.$" = "$.ownerId"
          }
        }
        ResultPath = "$.pollResult"
        Next       = "BumpPollAttempt"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "FailJob"
        }]
      }
      BumpPollAttempt = {
        Type = "Pass"
        Parameters = {
          "jobId.$"       = "$.jobId"
          "ownerId.$"     = "$.ownerId"
          "pollResult.$"  = "$.pollResult"
          "pollAttempt.$" = "States.MathAdd($.pollAttempt, 1)"
        }
        Next = "CheckReel"
      }
      CheckReel = {
        Type = "Choice"
        Choices = [
          {
            Variable     = "$.pollResult.Payload.reelStatus"
            StringEquals = "Completed"
            Next         = "Compose"
          },
          {
            Variable     = "$.pollResult.Payload.reelStatus"
            StringEquals = "Failed"
            Next         = "FailJob"
          },
          {
            Variable                 = "$.pollAttempt"
            NumericGreaterThanEquals = var.max_reel_poll_attempts
            Next                     = "FailJobTimeout"
          }
        ]
        Default = "WaitReel"
      }
      Compose = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.video_worker_lambda_arn
          Payload = {
            "source"    = "sfn-video"
            "step"      = "compose"
            "jobId.$"   = "$.jobId"
            "ownerId.$" = "$.ownerId"
          }
        }
        ResultPath = "$.composeResult"
        End        = true
        Catch = [{
          ErrorEquals = ["States.ALL"]
          ResultPath  = "$.error"
          Next        = "FailJob"
        }]
      }
      FailJobTimeout = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.video_worker_lambda_arn
          Payload = {
            "source"       = "sfn-video"
            "step"         = "fail"
            "jobId.$"      = "$.jobId"
            "ownerId.$"    = "$.ownerId"
            "forceFail"    = true
            "errorMessage" = "reel_poll_timeout"
          }
        }
        End = true
      }
      FailJob = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.video_worker_lambda_arn
          Payload = {
            "source"       = "sfn-video"
            "step"         = "fail"
            "jobId.$"      = "$.jobId"
            "ownerId.$"    = "$.ownerId"
            "forceFail"    = true
            "errorMessage" = "sfn_failed"
          }
        }
        End = true
      }
    }
  })
}

resource "aws_sfn_state_machine" "video" {
  count      = local.enabled ? 1 : 0
  name       = "${var.name_prefix}-video-studio"
  role_arn   = aws_iam_role.video_sfn[0].arn
  definition = local.definition
  tags       = var.tags
}

output "state_machine_arn" {
  value = try(aws_sfn_state_machine.video[0].arn, "")
}

output "state_machine_name" {
  value = try(aws_sfn_state_machine.video[0].name, "")
}

output "max_reel_poll_attempts" {
  value = var.max_reel_poll_attempts
}
