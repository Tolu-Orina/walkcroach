# WalkCroach Chrome

Manifest V3 extension (WXT + React). Trust-first SME page copilot.

## Quick start (local)

```bash
# Terminal 1 — Chrome BFF (port 3002)
cd infra-backend
npm install
npm run migrate
npm run dev:chrome

# Terminal 2 — extension
cd chrome
npm install
npm run dev
```

## Production Chrome Web Store zip

```bash
cd chrome
npm run zip:prod
# → .output/*.zip with live API + privacy URLs baked in
# Defaults: see release.env
```

| Script | Purpose |
|--------|---------|
| `npm run dev` | WXT dev (hot reload) |
| `npm run build` | Build (localhost defaults unless env set) |
| `npm run zip` | Zip current build |
| `npm run zip:prod` | **Store upload** — HTTPS bake, typecheck, test, localhost scan |
| `npm run test` | Unit tests |
| `npm run typecheck` | `tsc --noEmit` |

Public CWS checklist: `store/SUBMISSION_CHECKLIST.md`.

## Site profiles (Phase B)

- `lib/site-profiles/profiles.v1.json`
- Matcher: `lib/site-profiles/matcher.ts` (client-side only)

Default workspaces on first sector save: Hiring, Leads, Pricing, Property, Support.

## Web project linking (Phase C)

After account upgrade (Trust tab): Workspaces → Link to Web project.  
Public listing for v0.1.2 soft-pedals this path until Cognito browser sign-in ships.

## Privacy

Live: https://walkcroach.conquerorfoundation.com/chrome-privacy.html  
Source: `../web/public/chrome-privacy.html` (redeploy Web after edits).
