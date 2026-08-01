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
# creation fails with an image-not-found error. Run
# `./scripts/push-creative-image.sh latest` first.
creative_lambda_enabled   = true
creative_lambda_image_tag = "latest"
