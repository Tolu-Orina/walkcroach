# WalkCroach backend infrastructure (Terraform)

Provisions API Gateway REST (streaming routes), Lambda, Secrets Manager, SSM, IAM, artefacts S3, CloudWatch.

Region: **eu-west-2**.

## Layout

```
infra-backend/
├── main.tf / variables.tf / outputs.tf / versions.tf / providers.tf
├── packages/                 # Shared libs (npm workspaces under this folder)
│   ├── db/
│   └── agent-harness/
├── package.json              # Backend workspace root (install here)
├── tsconfig.base.json
├── modules/
│   ├── secrets/
│   ├── ssm/
│   ├── artefacts/
│   ├── lambda-agent/         # TF module + codes/
│   │   └── codes/            # @walkcroach/backend Lambda source
│   └── apigw-rest/
├── environments/{dev,test,prod}.tfvars
└── buildspec-*.yml
```

Package the Lambda zip into `modules/lambda-agent/.build/lambda.zip` before `terraform apply`:

```bash
cd infra-backend
npm install
npm run package:lambda
terraform init
terraform apply -var-file=environments/dev.tfvars
```

Then ensure Secrets Manager has `walkcroach/{env}/runtime` (manual) with JSON keys
`crdb_connection_string`, `crdb_mcp_api_key`, `aws_bearer_token_bedrock`, `walkcroach_api_key`.

Deploy order: **infra-backend → SSM api_url → infra-web**.

## Pipeline

`ci-cd/infra-backend-pipeline.yaml` — CodePipeline V2 + CodeConnections.

See `docs/plan1.md` Phase 2.
