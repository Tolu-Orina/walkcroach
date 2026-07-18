# WalkCroach Chrome

Manifest V3 extension (WXT + React). Phase 0 scaffold: FAB, side panel, health + anon device session against the Chrome BFF.

## Quick start

```bash
# Terminal 1 — Chrome BFF (port 3002)
cd infra-backend
npm install
npm run migrate          # applies 007_chrome_workspaces.sql
npm run dev:chrome

# Terminal 2 — extension
cd chrome
npm install
npm run dev              # opens Chromium with unpacked extension
```

Set `WALKCROACH_API_BASE` when pointing at a deployed API Gateway stage URL (must end with `/v1` or include `execute-api`):

```bash
WALKCROACH_API_BASE=https://xxxx.execute-api.eu-west-2.amazonaws.com/v1 npm run dev
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | WXT dev (hot reload) |
| `npm run build` | Production build → `.output/chrome-mv3` |
| `npm run zip` | Store-ready zip |
| `npm run test` | Unit tests |
| `npm run typecheck` | `tsc --noEmit` |

## Site profiles (Phase B)

Sector quick actions are driven by a versioned JSON bundle:

- `lib/site-profiles/profiles.v1.json`
- Matcher: `lib/site-profiles/matcher.ts` (client-side only; no per-navigation API)

### Bumping profiles (maintenance)

1. Edit `profiles.v1.json` (add host/path rules; keep `version` in sync with filename).
2. Add/adjust unit cases in `matcher.test.ts`.
3. Ship a new extension build (`npm run zip`) — profiles are bundled, not remote code (MV3 / store safe).
4. Do **not** fetch executable JS for profiles. If you later host remote JSON as **data**, bump `version` and validate shape before use.

Default workspaces created on first sector save: Hiring, Leads, Pricing, Property, Support.

## Web project linking (Phase C)

After Cognito upgrade (Trust tab):

1. Open **Workspaces** → select a workspace → **Link to Web project**.
2. New saves (and price tracks) also write `memory_entries` with `source_surface='chrome'`.
3. WalkCroach Web recall for that project includes those entries automatically (no surface filter).

APIs: `GET /chrome/v1/me/projects`, `POST /chrome/v1/workspaces/:id/link-project`.

## Store submission (Phase D)

Kit under `store/` (listing copy, privacy practices, permission justifications, checklist).

| Artifact | Path |
|----------|------|
| Privacy policy (HTTPS via Web host) | `../web/public/chrome-privacy.html` |
| Enterprise policy stub | `enterprise/policies.json` |
| Versioning | `VERSIONING.md` / `CHANGELOG.md` |

```bash
# Production zip (set live API + privacy URLs)
WALKCROACH_API_BASE=https://api.example.com/v1 \
WALKCROACH_PRIVACY_URL=https://app.example.com/chrome-privacy.html \
npm run zip
```

Follow `store/SUBMISSION_CHECKLIST.md` before uploading to the Chrome Web Store.

