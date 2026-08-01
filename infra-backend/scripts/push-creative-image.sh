#!/usr/bin/env bash
#
# Build and push the creative Lambda container, then print the tag to set.
#
# The ECR repository is created by Terraform (modules/lambda-creative), so the
# registry host, account id and repository name are all discoverable — this
# script looks them up rather than asking you to paste an account-specific URI
# into tfvars and get one character wrong.
#
#   ./scripts/push-creative-image.sh            # tag = short git sha
#   ./scripts/push-creative-image.sh v1         # explicit tag
#
# Then set creative_lambda_image_tag to the printed value and apply. That single
# value creates the creative Lambda AND, through its ARN, the video state
# machine — see the module comments in main.tf.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(cd .. && pwd)"

TAG="${1:-$(git -C "$REPO_ROOT" rev-parse --short HEAD)}"
REGION="${AWS_REGION:-eu-west-2}"

# Terraform is the source of truth for the repository URL; fall back to
# describing it directly so this still works from a machine without state.
REPO_URL="$(terraform output -raw creative_ecr_repository_url 2>/dev/null || true)"
if [ -z "$REPO_URL" ]; then
  NAME_PREFIX="${NAME_PREFIX:-walkcroach}"
  ENVIRONMENT="${ENVIRONMENT:-prod}"
  REPO_URL="$(aws ecr describe-repositories \
    --region "$REGION" \
    --repository-names "${NAME_PREFIX}-${ENVIRONMENT}-creative" \
    --query 'repositories[0].repositoryUri' --output text)"
fi

if [ -z "$REPO_URL" ] || [ "$REPO_URL" = "None" ]; then
  echo "Could not resolve the creative ECR repository URL." >&2
  echo "Apply Terraform first — the repository is created unconditionally," >&2
  echo "before and independently of the Lambda that uses it." >&2
  exit 1
fi

REGISTRY="${REPO_URL%%/*}"

echo "repository : $REPO_URL"
echo "tag        : $TAG"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

# Built from the repo root: the Dockerfile copies from infra-backend/ and the
# shared skills tree, so a narrower context would miss files.
docker build \
  --platform linux/amd64 \
  -f modules/lambda-creative/Dockerfile \
  -t "${REPO_URL}:${TAG}" \
  "$REPO_ROOT"

docker push "${REPO_URL}:${TAG}"

cat <<EOF

Pushed ${REPO_URL}:${TAG}

Next:
  terraform apply \
    -var="creative_lambda_enabled=true" \
    -var="creative_lambda_image_tag=${TAG}"

or add to environments/<env>.tfvars:
  creative_lambda_enabled   = true
  creative_lambda_image_tag = "${TAG}"

`creative_lambda_enabled` is the intent, the tag is which image. Together they
create the creative Lambda and, via its ARN, the video Step Functions worker.

They are separate so that blanking the tag is a plan-time error rather than a
silent teardown of both.
EOF
