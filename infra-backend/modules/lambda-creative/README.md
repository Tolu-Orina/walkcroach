# lambda-creative

Container Lambda for WalkCroach Creative Studio (Phase B+).

## Responsibilities

- `render_pptx` — Graphite Lumen 16:9 decks via `python-pptx` + HD helper
- Post-render **fail-closed** gate: `validate_pptx.py` must exit 0
- `thumbnail_pptx.py` → preview JPEG (LibreOffice + poppler)
- Allowlisted `run_skill_script` for any baked `skills/web/**/scripts`

## Local / CI

```bash
# From infra-backend/
pip install -r modules/lambda-creative/codes/requirements.txt
npm run smoke:pptx
npm run test:creative-scripts
```

Without LibreOffice, validate still must pass; thumbnail warns and is skipped.

## Container build (from walkcroach/ repo root)

```bash
docker build -f infra-backend/modules/lambda-creative/Dockerfile \
  -t walkcroach-creative:latest .
```

Prefer the script, which resolves the repository URL from Terraform state (or
from ECR directly) so no account-specific URI is ever typed by hand:

```bash
cd infra-backend
./scripts/push-creative-image.sh          # tag defaults to the short git sha
terraform apply \
  -var="creative_lambda_enabled=true" \
  -var="creative_lambda_image_tag=<tag>"
```

Two values, not one, and deliberately so. `creative_lambda_enabled` is the
intent; the tag is which image. With a single value, blanking the tag would
silently destroy the creative Lambda *and* the video state machine that keys off
its ARN — a hurried tfvars edit tearing down two things while looking like a
clean apply. Split, an empty tag while enabled is a plan-time error, and removal
requires setting `creative_lambda_enabled = false`.

Enabling creates the creative Lambda, and the Lambda ARN in turn creates the
video Step Functions worker — the creative handler already routes `action: "compose_video"`, so it
*is* the worker; there was never a second function to publish.

`creative_lambda_image_uri` remains for the genuine exception, an image in some
other registry, and wins when both are set.

Agent Lambda receives `CREATIVE_LAMBDA_NAME` and invokes it; when unset, the
harness falls back to the local Python handler (same JSON contract).
