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

Push the image to the ECR repo created by `modules/lambda-creative`, then set
`creative_lambda_image_uri` so Terraform creates the function. Agent Lambda
receives `CREATIVE_LAMBDA_NAME` and invokes it; when unset, the harness falls
back to the local Python handler (same JSON contract).
