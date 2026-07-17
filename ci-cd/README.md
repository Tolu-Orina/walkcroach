# CI/CD

CloudFormation templates for CodePipeline + CodeBuild (adapted from the IleraMed sample pattern):

- Source via AWS CodeConnections (GitHub)
- Non-prod (`develop`) and prod (`main`) pipelines
- Terraform validate → plan → (approval) → apply

## Files

| File | Purpose |
|------|---------|
| `infra-backend-pipeline.yaml` | Backend infra + Lambda deploy |
| `infra-web-pipeline.yaml` | Web infra + SPA sync to S3/CloudFront |

## Bootstrap names (manual, once per account)

| Resource | Name |
|----------|------|
| CodeConnections ARN (SSM) | `/walkcroach/cicd/codeconnections_arn` |
| Terraform state bucket | `walkcroach-tf-state` |
| Terraform lock table | `walkcroach-tf-lock` |
| Runtime secret (prod) | `walkcroach/prod/runtime` |
| Runtime secret (dev) | `walkcroach/dev/runtime` |

### 1. CodeConnections → SSM

```bash
aws ssm put-parameter \
  --region eu-west-2 \
  --name /walkcroach/cicd/codeconnections_arn \
  --type String \
  --value "arn:aws:codeconnections:eu-west-2:ACCOUNT:connection/ID"
```

### 2. Terraform state + lock

```bash
aws s3 mb s3://walkcroach-tf-state --region eu-west-2
aws dynamodb create-table \
  --region eu-west-2 \
  --table-name walkcroach-tf-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

### 3. Runtime secret (one JSON blob per env)

```bash
aws secretsmanager create-secret \
  --region eu-west-2 \
  --name walkcroach/prod/runtime \
  --secret-string '{
    "crdb_connection_string":"...",
    "crdb_mcp_api_key":"...",
    "aws_bearer_token_bedrock":"...",
    "walkcroach_api_key":""
  }'
```

Terraform **looks up** `walkcroach/{env}/runtime` — it does not create the secret.

### 4. Deploy pipelines

```bash
aws cloudformation deploy \
  --region eu-west-2 \
  --stack-name walkcroach-backend-pipeline \
  --template-file ci-cd/infra-backend-pipeline.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    GitHubOwner=Tolu-Orina \
    GitHubRepo=walkcroach

aws cloudformation deploy \
  --region eu-west-2 \
  --stack-name walkcroach-web-pipeline \
  --template-file ci-cd/infra-web-pipeline.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    GitHubOwner=Tolu-Orina \
    GitHubRepo=walkcroach
```

## Path filters

| Pipeline | Paths |
|----------|-------|
| Backend | `infra-backend/**` |
| Web | `infra-web/**`, `web/**` |

MVP notes: no ECR; Lambda zip via `npm run package:lambda`. Integration/E2E web stages are stubs.
