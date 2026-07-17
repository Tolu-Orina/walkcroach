# WalkCroach Web (Module 1 builder)

React + Vite + Tailwind SPA with StackBlitz **WebContainer** preview and NDJSON agent streaming.

## Local

```bash
# Terminal A — API (Phase 2 handlers / local server)
cd infra-backend
npm run dev

# Terminal B — builder UI
cd web
npm install
npm run dev
```

Open the Vite URL (COOP/COEP enabled). Set `VITE_API_URL` if the API is not on `http://localhost:3001`.

## Prod

Deployed to **https://walkcroach.conquerorfoundation.com** (`infra-web` + pipeline). CloudFront must keep COOP/COEP for WebContainer.

## Third-party

`@webcontainer/api` is StackBlitz proprietary — used under their published terms; not vendored into this MIT repo.
