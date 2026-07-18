# WalkCroach integration & E2E tests

Covers **web**, **Chrome**, and **IDE** surfaces.

## Layout

| Path | Purpose |
|------|---------|
| `integration/*.integration.test.ts` | Hit **deployed** Test API (`WALKCROACH_API_URL` / SSM) |
| `e2e/web/smoke.spec.ts` | Playwright SPA smoke (NFR-26 partial) |
| `e2e/chrome/extension.spec.ts` | Load unpacked WXT build in Chromium |
| `../infra-backend/.../chrome-api.integration.test.ts` | In-process Chrome BFF (supertest) |
| `../infra-backend/.../ide-api.integration.test.ts` | In-process IDE BFF (supertest) |
| `../infra-backend/.../local-api*.integration.test.ts` | In-process agent API |

## Local — deployed integration

```bash
export WALKCROACH_API_URL="https://xxxx.execute-api.eu-west-2.amazonaws.com/v1"
export WALKCROACH_ENV=test
export ALLOW_DEV_AUTH=true   # must match target Lambda env
cd tests && npm ci && npm run test:integration
```

Without `WALKCROACH_API_URL`, suites **skip** (no SSM unless `CI=true` or `WALKCROACH_USE_SSM=1`).

## Local — Playwright

```bash
export WALKCROACH_WEB_URL="http://localhost:5173"   # or deployed SPA
cd chrome && npm run build
export WALKCROACH_CHROME_EXTENSION_PATH="$(pwd)/.output/chrome-mv3"
cd ../tests && npm ci && npx playwright install chromium
npm run test:e2e
```

Full builder path (optional): `WALKCROACH_E2E_FULL=1`.

## CI

| Buildspec | Stage |
|-----------|--------|
| `web/buildspec-integration.yml` | Pipeline **IntegrationTest** |
| `web/buildspec-e2e.yml` | Pipeline **E2ETest** |

SSM parameters (Test):

- `/walkcroach/test/web/api_url` — required for integration
- `/walkcroach/test/web/web_url` — required for E2E (set via backend `web_app_url` tfvar)

Test env should keep `allow_dev_auth = true` so CI can use `Bearer dev:user:…` tokens.
