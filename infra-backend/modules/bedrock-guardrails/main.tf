/**
 * Amazon Bedrock Guardrails — prompt attack / leakage filter for Chat + agent.
 *
 * Standard tier enables PROMPT_LEAKAGE detection (AWS Security Blog / LLM07).
 * Standard tier REQUIRES cross-Region inference (guardrail profile).
 * Strength starts LOW (high-confidence blocks); raise after traffic testing.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-prompt-attack.html
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-cross-region-support.html
 * @see https://aws.amazon.com/blogs/security/designing-for-the-inevitable-system-prompt-leakage-and-mitigations-in-generative-ai-applications/
 */

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Geographic guardrail profiles by source Region.
  # eu-west-2 (London) uses the UK profile — not eu.guardrail.v1:0.
  guardrail_profile_by_region = {
    "eu-west-2"    = "uk.guardrail.v1:0"
    "eu-west-1"    = "eu.guardrail.v1:0"
    "eu-central-1" = "eu.guardrail.v1:0"
    "eu-west-3"    = "eu.guardrail.v1:0"
    "eu-north-1"   = "eu.guardrail.v1:0"
    "us-east-1"    = "us.guardrail.v1:0"
    "us-east-2"    = "us.guardrail.v1:0"
    "us-west-2"    = "us.guardrail.v1:0"
  }

  guardrail_profile_id = lookup(
    local.guardrail_profile_by_region,
    data.aws_region.current.region,
    "eu.guardrail.v1:0",
  )

  guardrail_profile_arn = "arn:aws:bedrock:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:guardrail-profile/${local.guardrail_profile_id}"
}

resource "aws_bedrock_guardrail" "chat" {
  name                      = "${var.name_prefix}-${var.environment}-chat"
  description               = "WalkCroach Chat prompt-attack / prompt-leakage guardrail"
  blocked_input_messaging   = "Sorry — that request was blocked by safety filters. Please rephrase without asking for internal instructions or system details."
  blocked_outputs_messaging = "Sorry — that response was blocked by safety filters."

  # Required for STANDARD tier (prompt leakage detection)
  cross_region_config {
    guardrail_profile_identifier = local.guardrail_profile_arn
  }

  content_policy_config {
    # PROMPT_ATTACK covers jailbreak, injection, and (Standard tier) prompt leakage
    filters_config {
      type             = "PROMPT_ATTACK"
      input_strength   = "LOW"
      output_strength  = "NONE"
      input_action     = "BLOCK"
      output_action    = "NONE"
      input_enabled    = true
      output_enabled   = false
      input_modalities = ["TEXT"]
    }

    tier_config {
      tier_name = "STANDARD"
    }
  }

  tags = var.tags
}

resource "aws_bedrock_guardrail_version" "chat" {
  description   = "${var.environment} published"
  guardrail_arn = aws_bedrock_guardrail.chat.guardrail_arn
  skip_destroy  = true
}

output "guardrail_id" {
  value = aws_bedrock_guardrail.chat.guardrail_id
}

output "guardrail_arn" {
  value = aws_bedrock_guardrail.chat.guardrail_arn
}

output "guardrail_version" {
  value = aws_bedrock_guardrail_version.chat.version
}

output "guardrail_profile_arn" {
  value = local.guardrail_profile_arn
}
