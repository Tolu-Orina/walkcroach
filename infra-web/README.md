# WalkCroach web infrastructure (Terraform)

Provisions S3 + CloudFront (+ optional ACM/Route53) for the builder SPA.

**Demo / prod URL:** https://walkcroach.conquerorfoundation.com

**Critical headers (WebContainer):**

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Region: **eu-west-2** (ACM for CloudFront is issued in **us-east-1**).

## Layout

```
infra-web/
├── modules/
│   ├── s3/
│   ├── cloudfront/   # OAC + COOP/COEP
│   ├── acm/          # us-east-1 cert + DNS validation
│   └── dns/          # A/AAAA alias → CloudFront
├── environments/{dev,test,prod}.tfvars
└── buildspec-*.yml
```

## Domain

| Env | `domain_name` |
|-----|----------------|
| prod | `walkcroach.conquerorfoundation.com` |
| dev / test | empty (CloudFront default URL) unless you set one |

Requires a public Route53 zone for `conquerorfoundation.com` in the same account.

## Local apply (prod)

```bash
cd infra-web
terraform init
terraform plan  -var-file=environments/prod.tfvars
terraform apply -var-file=environments/prod.tfvars
```

SPA build injects `VITE_API_URL` from SSM `/walkcroach/{env}/web/api_url` (see `web/buildspec.yml`).

## Pipeline

`ci-cd/infra-web-pipeline.yaml` — validate/plan/apply TF, then build + S3 sync + CloudFront invalidate.
