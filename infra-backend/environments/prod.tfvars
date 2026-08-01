environment                     = "prod"
aws_region                      = "eu-west-2"
project_name                    = "walkcroach"
hosted_zone_name                = "conquerorfoundation.com"
apps_wildcard_domain            = "walkcroach.conquerorfoundation.com"
web_app_url                     = "https://walkcroach.conquerorfoundation.com"
allow_dev_auth                  = false
allow_github_pat                = false
enable_apigw_cognito_authorizer = true

# Creative Lambda (slides, flyers, images) and the video state machine that
# keys off its ARN. `enabled` is the intent; the tag is which image.
#
# ORDER MATTERS: the image must exist in ECR *before* this applies, or Lambda
# creation fails with an image-not-found error. The pipeline builds it in the
# Test stage, ahead of the Deploy stage that plans.
#
# BOOTSTRAP — currently pass 1 of 2. Set back to `true` once this has applied.
#
# The repository cannot be created while `enabled = true`. With enabled, the
# `data.aws_ecr_image` lookup has count = 1 and its repository_name is known at
# plan time, so Terraform reads it BEFORE creating anything, finds no image, and
# fails the plan — leaving the repository uncreated, which is why the read
# failed. Nothing breaks that cycle by re-running.
#
#   pass 1 (enabled = false) — count = 0, no lookup. Repository is created
#                              (it is unconditional), Lambda and the video
#                              state machine are not.
#   pass 2 (enabled = true)  — the Test stage now finds the repository, builds
#                              and pushes `latest`, and the plan resolves it.
#
# Needed here because the repository was renamed to carry the environment
# (walkcroach-prod-creative). Any future rename re-enters the same two passes.
creative_lambda_enabled   = false
creative_lambda_image_tag = "latest"
