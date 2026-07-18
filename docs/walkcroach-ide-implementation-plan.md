# WalkCroach IDE — Implementation Plan

**Status:** Ready to implement (pending capacity allocation vs Web/Chrome)  
**Module:** Module 3 — WalkCroach IDE (VS Code extension + companion CLI)  
**Companion docs:** `walkcroach-ide-prd.md`, `plan1.md`, `walkcroach-chrome-implementation-plan.md`, `walkcroach-web-implementation-plan.md`  
**Research cutoff:** July 2026  
**Last updated:** July 18, 2026

---

## 0. One-sentence thesis

> WalkCroach IDE is a **local-first** agent (custom VS Code webview + CLI sharing one engine) that uses Bedrock Nova for the loop and CockroachDB’s agent-ready tooling (MCP, vector index, ccloud CLI, Agent Skills) for database work — while a **thin `/ide` BFF** only handles auth, project link, and shared memory mirror/recall against the same Cognito + CockroachDB plane as Web and Chrome.

**Platform stays shared. Agent runs locally. Surface adapter is new.**

This is the same split Chrome already shipped (`lambda-chrome` + shared db/memory), applied to a Cline/Continue-class product surface — without repeating Cline’s early mistake of growing the agent loop inside the extension until CLI parity becomes a rewrite.

---

## 1. Locked architecture decisions

Do not reopen unless blocked. These supersede the thin Phase 6 stub in `plan1.md` and bind the IDE PRD §9 decisions.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Editor paradigm | **True VS Code extension** (Marketplace / Open VSX), not a fork | Zero-migration install (FR-D01); forks (Cursor/Windsurf/Kiro IDE) force tool migration |
| Chat UI | **Custom webview sidebar**, not Chat Participant API | Own branding, Nova/Bedrock model, system prompt, approval UX; Chat Participant ties to Copilot Chat and blocks system-prompt control in agent mode (PRD §2.2) |
| Agent placement | **Local extension host + shared engine package**; not Web Lambda | Hosted IDE agent is out of scope (PRD §13); WebContainer tool protocol is wrong for local fs/terminal |
| Engine / CLI | **Extract agent engine first** (or by end of Phase A); CLI embeds same package | Cline’s May 2026 SDK rewrite proved: extension-first → CLI later costs a full harness rewrite. Continue’s `core` ↔ IDE ↔ GUI split is the proven pattern |
| Cloud compute | **Thin new Lambda** `walkcroach-ide-{env}` behind `/ide/*` on existing API Gateway | Same Chrome pattern; do **not** bolt onto `lambda-agent` (builder protocol) or fork Cognito/CRDB |
| Data + identity | **Same** Cognito pool, CockroachDB cluster, Titan embeddings, Secrets Manager | Cross-surface memory is the product moat vs Kiro (FR-D08, FR-D15, FR-D27) |
| Shared packages | Reuse `@walkcroach/db` + memory write/recall from harness; **do not** import WebContainer tools | Same migrations and C-SPANN path; local tools are fs/terminal/MCP/ccloud |
| Model | Nova 2 Lite via Bedrock `ConverseStream` (+ prompt caching) | Matches Web/Chrome; Bedrock `cachePoint` cuts TTFT up to ~85% on stable prefixes |
| Auth (Phase C) | Cognito PKCE via VS Code auth / external URI; tokens in `SecretStorage` | NFR-D04; no anon-device primary path (unlike Chrome) — local-only mode needs no account |
| Cockroach tools | MCP (interactive read-default) · ccloud CLI (infra, approval-gated) · Agent Skills (judgment) · vector index (recall) | CockroachDB’s own MCP-vs-CLI guidance (PRD §2.8); skills = progressive disclosure `SKILL.md` |
| Out of scope | JetBrains/Neovim · hosted cloud agent · unattended infra · Kiro-depth EARS specs | PRD §13 |

### What “same infra” means vs does not mean

| Shared (one of each) | Separate (IDE-owned) |
|----------------------|----------------------|
| AWS account / envs | Local agent engine package + VS Code extension + CLI |
| Cognito User Pool | Terraform `lambda-ide` + handlers under `/ide` |
| CockroachDB + migrations | Marketplace / Open VSX release train |
| Bedrock Nova 2 Lite + Titan Embeddings V2 | Extension host tools (fs, terminal, MCP client, ccloud spawn) |
| Terraform root (`infra-backend` extend) | Local session state, diffs, approval UX |
| Observability account | CLI packaging (`npm` / binary) |

**Do not:** reuse Web `/sessions/:id/prompt` or Chrome `/chrome/v1/summarize` as the IDE agent loop.  
**Do:** reuse `recall_project_memory` / `writeMemoryEntry` semantics and `memory_entries` with `source_surface = 'ide'`.

---

## 2. Research findings (July 2026)

### 2.1 Competitor product models

| Product | Architecture | How they feel fast | Gap we exploit |
|---------|--------------|--------------------|----------------|
| **Cline** (5M+ installs → SDK May 2026) | Custom webview; agent loop extracted to `@cline/sdk` / `@cline/agents` (stateless) + `@cline/core` (sessions, MCP, subagents). CLI + Kanban already on SDK; IDE migrating | Shared harness across surfaces; stream UI; Plan/Act approvals; Bedrock among providers | No durable **cross-product** memory graph; memory is local/session. Their painful lesson: don’t grow the loop inside the extension first |
| **Continue** | `core` (TS, IDE-agnostic) ↔ thin IDE adapter ↔ React GUI; typed message protocol; pass-through for streaming | In-process core on VS Code (low hop); pass-through messages avoid IDE mediation on hot path | Index/RAG local; no WalkCroach-style shared CRDB memory across browser builder + research extension |
| **Claude Code** | Terminal-native; hierarchical subagents (isolated context); Skills + Hooks + MCP; prompt-cache-first harness | Prompt caching = primary TTFT/cost lever; subagents return summaries only; Haiku for explorers / Sonnet coordinator | File/local memory only; no Web↔Chrome↔IDE graph. Best sub-agent playbook to copy for schema migrations |
| **Kiro** (AWS, GA Mar 2026) | Code OSS fork + CLI; specs (`requirements`/`design`/`tasks`); steering files; MCP; Powers (on-demand domain packs) | Spec approval before codegen; Bedrock Claude/Nova; `.kiro/` committed config | **No cross-tool durable memory** — our explicit differentiator. Do not compete on EARS-depth specs |
| **Roo Code** | Dual-process (host + React webview); modes (Code/Architect/Ask/Debug/Orchestrator) | Mode-tuned prompts | Shut down May 15, 2026 — architecture still instructive; avoid building a mode zoo for MVP |
| **GitHub Copilot** | Chat Participant + agent mode; prompt cache + tool search; cache-aware model routing | TTFT via cache; defer tool schemas | We cannot depend on Copilot as host (PRD §9) |
| **Cursor / Windsurf** | Forked editors | Deep editor integration, local index | Ruled out — migration tax |

**Industry convergence (every serious agentic IDE/CLI):**

```text
Webview / CLI UI  (thin, stream-coalesced)
        ↕  typed messages / events
Agent engine      (stateless loop + hooks)
        ↕  HostAdapter (VS Code | terminal | CI)
Tools: fs · terminal · MCP · skills · (optional cloud BFF)
        ↕
Model provider (Bedrock / Anthropic / …)  +  durable memory store
```

Nobody serious puts API keys in the webview. Nobody serious makes CLI a thinner reimplementation of the IDE. Nobody serious buffers the full answer before first paint.

### 2.2 What actually makes them feel “highly performant”

Ordered by impact for WalkCroach IDE (from Cline SDK posts, Continue architecture, Claude Code caching lessons, Kilo Code / Codex extension streaming PRs, Bedrock docs, VS Code Webview guide — July 2026):

1. **Time to first streamed token, not total task time.** Target ≤ 2.5s p50 (NFR-D02). Users forgive a 30s task if tokens and tool cards appear immediately.
2. **Prompt caching as an architectural constraint, not an afterthought.** Claude Code’s public lesson (2026): *“prompt caching is everything.”* Static → dynamic order: tools → system → project rules (`WALKCROACH.md` + skill metadata) → conversation. Bedrock `cachePoint` on ConverseStream; Nova 2 Lite min ~1,536 tokens for first checkpoint. Monitor `cacheReadInputTokens` like uptime. Don’t change model mid-session; don’t put timestamps in the cached prefix.
3. **Coalesce webview updates.** Mapping every token delta to `postMessage` saturates the renderer (Kilo Code: 479 HandlePostMessage in 17s → multi-second layout). Pattern: queue by message/part id → merge text deltas → flush active session ~16ms (rAF); background sessions 150–400ms batches. Prefer `getState`/`setState` over `retainContextWhenHidden` (VS Code docs: high memory cost).
4. **Local tools have zero network RTT.** File read/write, grep, git status, terminal — run in extension host. Only Bedrock, memory mirror, and MCP (when remote) leave the machine. This is why local-first beats bolting IDE onto the Web Lambda.
5. **Context hygiene beats bigger context windows.** Cap tool result size; return sub-agent **summaries** not transcripts; progressive skill load (metadata always, body on match — Agent Skills spec); compact long sessions with a cache-aware strategy (same system+tools on compact call when possible).
6. **Activation latency.** Lazy-activate on sidebar view / command; keep `activate()` cheap; defer MCP connect and skill full-load until first task.
7. **Approval UX that doesn’t feel slow.** Show diff/command preview incrementally while the model is still thinking about the next step when safe; never block streaming on waiting for approval of a prior step that already finished rendering.
8. **Backend close to model for cloud hops.** Phase C `/ide` Lambda in eu-west-2 next to Bedrock/CRDB — same as Web/Chrome. Memory recall ≤ 1.5s p95 (NFR-D03).

### 2.3 Safety and approval (mandatory)

Kiro’s Feb 2026 production-adjacent incident narrative (PRD §2.4) plus CockroachDB’s MCP-vs-CLI split:

| Action class | Gate |
|--------------|------|
| File write / terminal | Diff/command preview; approve by default (FR-D04) |
| MCP write | Opt-in per action; connection stays read-only until consent (FR-D12) |
| ccloud provision / networking / delete | **Hard gate always** — never in low-friction mode (FR-D18) |
| Untrusted workspace | Respect VS Code Workspace Trust; disable agentic tools until trusted (NFR-D07) |

Secrets: VS Code `SecretStorage` / OS keychain only (NFR-D04). No Cognito tokens or ccloud keys in `settings.json` or workspace files.

### 2.4 Agent Skills (open standard, 2026)

Agent Skills (`SKILL.md` + optional `scripts/` / `references/`) are the industry format (Claude Code, Cursor, Copilot, Codex, Gemini CLI, Roo forks, etc.). Progressive disclosure:

1. Load **name + description** for all skills at session start (~100 tokens each).  
2. Load full body when matched.  
3. Load resources only when referenced.

WalkCroach must conform (NFR-D13) and ship / vendor **CockroachDB Agent Skills** (cockroachdb-skills / claude-plugin ecosystem) for schema, ops, and query tasks — not invent a parallel format.

### 2.5 Sub-agents (copy Claude Code’s constraints)

- Parent keeps orchestration; children get isolated context and return **summaries**.  
- Cap concurrency (industry practice: ~3–5 for everyday work; dynamic fan-out for large migrations only).  
- Prefer cheaper/faster model for explore/grep sub-agents if multi-model is available later; Nova 2 Lite alone is fine for hackathon.  
- Surface named sub-tasks in the UI (FR-D22) — never a black box.  
- Defer nested sub-agents and “agent teams” if Phase A slips (PRD §12).

### 2.6 How WalkCroach can be better

| Dimension | Competitors | WalkCroach edge |
|-----------|-------------|-----------------|
| Memory | Local files / session / editor index | **Same C-SPANN graph** as Web builder + Chrome research (`source_surface` filter) |
| Cockroach story | Generic SQL / optional MCP | **MCP + ccloud + Skills + vector** each with one job — living demo of Cockroach’s agent-ready stack |
| Engine reuse | Cline learned late; many CLIs lag IDE | **Engine-first from Phase A** so CLI is parity, not an afterthought (FR-D23) |
| Positioning vs Kiro | Spec depth | Don’t fight specs — win the **30-second demo** on cross-surface recall |
| Trust | Mixed | Hard infra gate + Workspace Trust + SecretStorage from day one |
| Cost at idle | Often always-on control planes | Thin `/ide` Lambda scale-to-$0 (NFR-D16); local loop needs no server |

---

## 3. Target architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  Developer machine                                                         │
│  ┌─────────────────────┐     typed events      ┌───────────────────────┐ │
│  │ VS Code webview UI  │◄─────────────────────►│ Extension host        │ │
│  │ React panel         │   coalesced streams   │ HostAdapter (vscode)  │ │
│  │ diffs / approvals   │                       │ SecretStorage, terms  │ │
│  └─────────────────────┘                       └───────────┬───────────┘ │
│                                                            │               │
│  ┌─────────────────────┐                                   │               │
│  │ walkcroach CLI      │── HostAdapter (stdio/TTY) ────────┤               │
│  └─────────────────────┘                                   ▼               │
│                                              ┌─────────────────────────┐   │
│                                              │ @walkcroach/agent-engine│   │
│                                              │ gather → act → verify   │   │
│                                              │ tools · skills · MCP    │   │
│                                              │ subagents · approvals   │   │
│                                              └───────────┬─────────────┘   │
│                    Bedrock ConverseStream ◄──────────────┤                 │
│                    (local AWS creds or Phase C proxy)    │                 │
│                    MCP → cockroachlabs.cloud/mcp         │                 │
│                    ccloud CLI (spawn, -o json)            │                 │
│                    WALKCROACH.md (git-diffable)          │                 │
└──────────────────────────────────────────────────────────┼─────────────────┘
                                                           │ HTTPS (Phase C+)
                                                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  API Gateway REST  (/ide/*)  — Cognito JWT                                 │
│  Lambda: walkcroach-ide-{env}                                              │
│  handlers: me/projects · link · memory/mirror · memory/recall ·            │
│            optional bedrock/proxy · usage                                  │
│  uses: @walkcroach/db, Titan embed, memory helpers (not Web tools)         │
└───────────────┬──────────────────────────────┬───────────────────────────┘
                ▼                              ▼
         CockroachDB                    Cognito (same pool)
         projects                       CloudWatch
         memory_entries (source_surface=ide)
         ide_project_links (new)
```

**Web Lambda and Chrome Lambda stay untouched** for their routes. IDE never calls `/sessions/:id/prompt` or `/chrome/v1/*` for the agent loop.

### 3.1 Package layering (learn from Cline/Continue)

| Package | Responsibility | Depends on |
|---------|----------------|------------|
| `@walkcroach/agent-engine` | Stateless loop, tool registry, skills loader, MCP client glue, sub-agent spawn, event stream | Bedrock SDK (or injected model client), pure Node APIs |
| `@walkcroach/ide-host-vscode` | Implements `HostAdapter`: fs, terminal, diff UI, SecretStorage, workspace trust | `vscode` API + engine |
| `@walkcroach/ide-cli` | Implements `HostAdapter` for TTY/CI; JSON output mode | engine |
| `@walkcroach/ide-webview` | React UI only; no secrets; no direct Bedrock | postMessage protocol |
| `@walkcroach/ide-api` (Lambda) | Thin BFF: authz, link, memory mirror/recall | `@walkcroach/db`, harness memory helpers |

Optional later: split harness into `@walkcroach/memory` so Web/Chrome/IDE don’t share codegen tool types — nice-to-have, not Phase A blocker.

---

## 4. Repo layout

```text
walkcroach/
├── ide/                                   # NEW — VS Code extension (own package.json)
│   ├── package.json                       # contributes views, commands, activationEvents
│   ├── src/
│   │   ├── extension.ts                   # activate: register webview + commands
│   │   ├── host/VsCodeHostAdapter.ts
│   │   ├── webview/                       # or separate package built into media/
│   │   ├── auth/cognito.ts                # Phase C
│   │   └── api/ideClient.ts               # Phase C BFF client
│   ├── media/                             # bundled webview assets
│   └── .vscodeignore
├── packages/
│   └── agent-engine/                      # NEW — shared by extension + CLI
│       ├── src/
│       │   ├── loop.ts                    # gather → act → verify
│       │   ├── tools/                     # read_file, write_file, run_terminal, …
│       │   ├── approvals.ts
│       │   ├── skills.ts                  # Agent Skills progressive load
│       │   ├── mcp.ts                     # Managed MCP client
│       │   ├── ccloud.ts                   # spawn + parse -o json
│       │   ├── subagents.ts
│       │   ├── memory-local.ts            # WALKCROACH.md
│       │   ├── bedrock.ts                 # ConverseStream + cachePoint
│       │   └── host.ts                    # HostAdapter interface
│       └── package.json
├── cli/                                   # NEW — walkcroach CLI (Phase D; can scaffold earlier)
│   ├── src/index.ts
│   └── package.json
├── infra-backend/
│   ├── modules/lambda-ide/                # NEW TF module
│   ├── packages/
│   │   ├── db/                            # migration 008_ide_links.sql
│   │   └── agent-harness/                 # shared embed/recall (reuse)
│   └── ...
├── ci-cd/                                 # path filter: ide/**, packages/agent-engine/**
└── docs/
    ├── walkcroach-ide-prd.md
    └── walkcroach-ide-implementation-plan.md   # this file
```

Install/run (same multi-root pattern as `web/` / `chrome/`):

```bash
cd packages/agent-engine && npm i && npm run test
cd ide && npm i && npm run watch          # F5 Extension Development Host
cd infra-backend && npm run migrate && npm run dev:ide   # Phase C+
cd cli && npm i && npm run start -- ask "..."
```

---

## 5. Data model

Migration `008_ide_links.sql` (additive; do not rewrite earlier migrations). Schema already allows `source_surface` / `surface_origin` values including IDE conceptually — normalize on write to `'ide'`.

```sql
-- Link a local workspace identity to a WalkCroach Web project
CREATE TABLE IF NOT EXISTS ide_project_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,                    -- Cognito sub
  project_id UUID NOT NULL REFERENCES projects(id),
  -- Stable local identity (prefer git remote URL normalized; else workspace folder hash)
  local_repo_key STRING NOT NULL,
  local_repo_display STRING,                   -- path or remote for UI
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, local_repo_key)
);

CREATE INDEX IF NOT EXISTS ide_project_links_owner_id_idx ON ide_project_links (owner_id);
CREATE INDEX IF NOT EXISTS ide_project_links_project_id_idx ON ide_project_links (project_id);

-- Optional: audit of mirrored memory from IDE (provenance; memory_entries remains SoR)
-- Prefer writing directly to memory_entries with source_surface='ide' and metadata JSON.
```

**Memory write (Phase C):** reuse existing `memory_entries` insert + Titan embed path:

- `source_surface = 'ide'`
- `kind` ∈ preference | decision | convention | summary (align with Web/Chrome kinds already in use)
- Text = distilled bullet from approved decisions / `WALKCROACH.md` deltas (not raw chat dumps)

**Recall:** same C-SPANN / cosine path as Web; optional filter `source_surface IN (...)` (FR-D16).

---

## 6. IDE BFF API surface

Base path: `/ide/v1`. Cognito JWT required on all routes except health. **No streaming agent loop here** — streaming is local Bedrock (or optional proxy below).

| Method | Route | Mode | Purpose | Phase |
|--------|-------|------|---------|-------|
| GET | `/ide/v1/health` | buffered | Liveness | 0 |
| GET | `/ide/v1/me` | buffered | Identity + link status | C |
| GET | `/ide/v1/me/projects` | buffered | List linkable Web projects | C |
| POST | `/ide/v1/links` | buffered | Link `local_repo_key` → `project_id` | C |
| GET | `/ide/v1/links` | buffered | List links for user | C |
| DELETE | `/ide/v1/links/:id` | buffered | Unlink | C |
| POST | `/ide/v1/memory/mirror` | buffered | Embed + insert `memory_entries` | C |
| POST | `/ide/v1/memory/recall` | buffered | Vector recall (+ optional surface filter) | C |
| POST | `/ide/v1/bedrock/proxy` | **stream** | Optional: stream ConverseStream with server IAM (if local AWS creds undesirable) | C (optional) |
| POST | `/ide/v1/usage` | buffered | Record turn cost against `usage_ledger` if billing applies | C (optional) |

### Auth headers

- `Authorization: Bearer <cognito_access_token>`
- Project-scoped operations: verify `projects.owner_id` (or membership if that lands later) matches `sub`

### Bedrock credential strategy

| Mode | When | How |
|------|------|-----|
| **Local AWS profile / env** | Phase A–B default for hackathon | Extension uses `@aws-sdk/client-bedrock-runtime` with default credential chain; document required IAM |
| **BFF proxy** | Phase C if judges/users lack AWS creds | `/ide/v1/bedrock/proxy` streams tokens; still **local** tool execution; scale-to-$0 Lambda |

Prefer local credentials for Phase A to keep the BFF out of the critical path until memory linking matters.

---

## 7. Performance budget

Tied to PRD NFRs. Treat as exit criteria.

| Metric | Target | How we hit it |
|--------|--------|---------------|
| Sidebar webview interactive | ≤ 1s (NFR-D01) | Lazy activate; prebuilt webview bundle; no network on open |
| First streamed agent token | ≤ 2.5s p50 (NFR-D02) | ConverseStream; Bedrock prompt cache; warm credential provider; small first-turn context |
| `recall_project_memory` | ≤ 1.5s p95 (NFR-D03) | Same C-SPANN path; limit k; Phase C BFF in eu-west-2 |
| Webview stream jank | No multi-second layout stalls | Coalesce postMessage (~16ms active); no per-token React tree rebuild |
| Extension host idle | Negligible | No background scrape; MCP connect on demand |
| Prompt cache hit rate | Track as metric; aim ≥ 70% after turn 2 | Static prefix ordering; stable tool schemas; no mid-session model switch |

**Payload / context caps (initial):**

- Tool result truncation: e.g. 30–50k chars per result with clear `…truncated` marker  
- `WALKCROACH.md` inject: first N KB + heading outline if huge  
- Skill metadata always; full skill body only when selected  
- Sub-agent return: summary ≤ ~2k tokens  

---

## 8. Extension / engine internal design

### 8.1 HostAdapter interface (sketch)

```typescript
interface HostAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;  // gated by Approvals
  applyDiff?(path: string, diff: string): Promise<void>;
  runTerminal(cmd: string, opts: { cwd: string }): AsyncIterable<TerminalChunk>;
  showDiffPreview(path: string, before: string, after: string): Promise<'approve' | 'reject'>;
  confirmCommand(cmd: string): Promise<'approve' | 'reject'>;
  getWorkspaceRoot(): string | undefined;
  isTrustedWorkspace(): boolean;
  secrets: { get(k: string): Promise<string | undefined>; store(k: string, v: string): Promise<void> };
  emit(event: AgentEvent): void; // tokens, tool cards, subagent status
}
```

CLI implements the same interface with stdin prompts (or `--yes` / `--non-interactive` for CI — FR-D25).

### 8.2 Message protocol (webview ↔ host)

Closed allowlist (extend deliberately):

| Type | Direction | Notes |
|------|-----------|-------|
| `READY` | webview → host | Hydrate state |
| `SUBMIT_TASK` | webview → host | User prompt + mode |
| `APPROVE_STEP` / `REJECT_STEP` | webview → host | Diff/command gate |
| `SET_AUTONOMY` | webview → host | Low-friction dial (never lifts ccloud gate) |
| `CANCEL` | webview → host | AbortSignal into loop |
| `TOKEN_DELTA` / `TOOL_CARD` / `PHASE` / `SUBAGENT` / `DONE` / `ERROR` | host → webview | Coalesced |
| `STATE_SNAPSHOT` | host → webview | Session restore |

Reject unknown types. Webview never receives raw Cognito refresh tokens or ccloud keys.

### 8.3 Agent loop (FR-D03)

```text
gather:  read WALKCROACH.md · git status · relevant files · optional recall (if linked)
act:     model proposes tools → preview → approve → execute → observe
verify:  run tests/build if configured · read output · iterate or finish
```

Plan-lite mode (optional): gather + propose plan without writes (Cline Plan-inspired) — lighter than Kiro EARS.

### 8.4 Prompt assembly (cache-first)

Order every Bedrock request:

1. Tool definitions (stable) + `cachePoint`  
2. System prompt (stable) + `cachePoint`  
3. Skill **metadata** list (stable within session)  
4. `WALKCROACH.md` + linked memory snippets (semi-stable) + `cachePoint` if large enough  
5. Conversation + dynamic tool results (never before cache breakpoints)

Log `cacheReadInputTokens` / `cacheWriteInputTokens` to CloudWatch (local telemetry file in Phase A).

### 8.5 Cockroach tool routing (FR-D11–D21)

| User intent | Tool path |
|-------------|-----------|
| “What’s the schema for orders?” | Managed MCP `get_table_schema` / `select_query` (read-only) |
| “Design an index for …” | Load CockroachDB Agent Skill → propose DDL → approval → MCP write or SQL via approved path |
| “Create a preview cluster / fix networking” | `ccloud … -o json` only; hard confirmation; least-privilege service account (FR-D17) |

MCP config from Cloud Console snippet → stored in SecretStorage, not repo.

### 8.6 Local memory

- Maintain / propose edits to `WALKCROACH.md` at repo root (FR-D07).  
- On Phase C link: distill approved decisions → `POST /ide/v1/memory/mirror`.  
- Expose `recall_project_memory` tool in the engine when linked (FR-D09).

---

## 9. Phased implementation

Capacity assumption: IDE is a **parallel track** or **fast-follow** after Web (and optionally Chrome). Phases are sequential for IDE itself. **Phase A alone is demoable** (PRD §11).

Each phase has **exit criteria**. Do not start the next phase until exits pass.

---

### Phase 0 — Scaffold + engine skeleton (3–5 days) ✅ **IMPLEMENTED (local)**

**Goal:** Empty extension opens a webview in ≤ 1s; engine package exists with a hello-stream against Bedrock; no product features yet.

| # | Task | Status |
|---|------|--------|
| P0.1 | Scaffold `ide/` VS Code extension (TypeScript, esbuild, React webview) | ✅ |
| P0.2 | Scaffold `packages/agent-engine` with `HostAdapter`, event types, abortable loop stub | ✅ |
| P0.3 | Wire webview ↔ host allowlist + coalesced `TOKEN_DELTA` flush | ✅ |
| P0.4 | Bedrock `ConverseStream` smoke (Nova 2 Lite) from engine with `cachePoint` on system | ✅ |
| P0.5 | Workspace Trust check stub; disable tools if untrusted | ✅ |
| P0.6 | CI path filter: typecheck/test engine + package VSIX artifact | ✅ |
| P0.7 | Document local AWS credential requirements in `ide/README.md` | ✅ |

**Local verify:**
```bash
cd packages/agent-engine && npm i && npm test && npm run build
# optional live Bedrock: npm run smoke:ping
cd ../../ide && npm i && npm run build
# F5 → WalkCroach sidebar → Ping (workspace must be Trusted)
```

**Exit:** F5 Extension Development Host → sidebar loads ≤ 1s → “ping” command streams tokens into panel. Engine unit test passes without VS Code.

---

### Phase A — Core local agent (PRD Phase A) ✅ **IMPLEMENTED (local)**

**Goal:** FR-D01–D07, FR-D22 (sub-agents SHOULD — implement minimal or stub with clear defer). Fully usable with **no** WalkCroach account.

#### A1. Tools + approvals (foundation)

| # | Task | Status |
|---|------|--------|
| PA.1 | Tools: `read_file`, `list_dir`, `search` (rg), `write_file`, `edit_file`, `run_terminal` | ✅ |
| PA.2 | Diff preview + command preview UI; default require approve | ✅ |
| PA.3 | Autonomy dial (opt-in low-friction for narrow repeated edits); **exclude** infra forever | ✅ |
| PA.4 | Three-phase loop with visible phase + tool cards | ✅ |
| PA.5 | Cancel / AbortSignal mid-run | ✅ |
| PA.6 | Persist session transcript to workspace storage (not secrets) | ✅ |

**Exit:** User can ask “add a health route” on a sample repo; sees diffs; approves; file on disk matches; terminal test run gated.

#### A2. Local memory + prompt cache hardening

| # | Task | Status |
|---|------|--------|
| PA.7 | Create/update `WALKCROACH.md` proposals as reviewable diffs | ✅ |
| PA.8 | Cache-stable prompt assembler + metrics for cache hits | ✅ |
| PA.9 | Context truncation policies for tool results | ✅ |
| PA.10 | Panel load budget regression test (bundle size / activate time) | ✅ |

**Exit:** Second turn in same session shows improved TTFT (cache read > 0). `WALKCROACH.md` appears via approved write.

#### A3. Sub-agents (minimal viable)

| # | Task | Status |
|---|------|--------|
| PA.11 | Parent can spawn ≤ N named sub-agents with isolated message lists | ✅ |
| PA.12 | UI shows sub-agent status; parent receives summaries only | ✅ |
| PA.13 | Feature flag: `subagentsEnabled` (default true; set false to disable) | ✅ |

**Exit:** Multi-file rename demo fans out (or documented defer with flag).

**Phase A product exit bar:** Install → open folder → complete one approved multi-step task with zero WalkCroach login (UJ-D1–D3).

**Local verify:**
```bash
cd packages/agent-engine && npm i && npm test && npm run build
cd ../../ide && npm i && npm run build && npm run check:bundle
# F5 → Trust workspace → Run a task → Approve diffs
```

---

### Phase B — CockroachDB tool integration (PRD Phase B) ✅ **IMPLEMENTED (local)**

**Depends on:** Phase A loop. Uses existing CockroachDB Cloud cluster / project DB — not a new WalkCroach backend requirement beyond docs/secrets UX.

| # | Task | Maps to |
|---|------|---------|
| PB.1 | MCP client: connect via Cloud Console snippet; default read-only | FR-D11 |
| PB.2 | Tools: schema inspect, `select_query`, explain; write requires extra consent | FR-D12, FR-D14 |
| PB.3 | Rely on Managed MCP audit log; don’t proxy MCP through our Lambda | FR-D13 |
| PB.4 | Vendor/load CockroachDB Agent Skills (progressive disclosure) | FR-D20, FR-D21 |
| PB.5 | `ccloud` runner: discover via `--help`, execute with `-o json`, hard confirm | FR-D17–D19 |
| PB.6 | Service-account scoped credentials in SecretStorage | NFR-D05 |
| PB.7 | Plain-language errors + retry for MCP/ccloud failures | NFR-D09 |
| PB.8 | Telemetry: mcp_calls, ccloud_actions, skills_invoked | NFR-D15, success metrics |

**Exit:** Demo path: inspect schema via MCP → skill-guided index proposal → user rejects write → separate flow provisions preview resource via ccloud with explicit confirm (UJ-D5–D7).

**Local verify:**
```bash
cd packages/agent-engine && npm test && npm run typecheck && npm run build
cd ../../ide && npm run typecheck && npm run build && npm run check:bundle
# F5 → Configure CockroachDB → task using cockroach_mcp / load_skill / ccloud
```

---

### Phase C — Cross-surface memory (PRD Phase C) ✅ **IMPLEMENTED (local)**

**Depends on:** WalkCroach Web Cognito + `projects` + `memory_entries` stable (same bar Chrome Phase C used).

| # | Task | Maps to | Status |
|---|------|---------|--------|
| PC.1 | Terraform `lambda-ide` + API Gateway `/ide/{proxy+}` | Chrome pattern | ✅ |
| PC.2 | Migration `008_ide_links.sql` | FR-D26, FR-D28 | ✅ |
| PC.3 | Cognito PKCE sign-in from extension; tokens in SecretStorage | NFR-D04 | ✅ (+ paste-token fallback) |
| PC.4 | Link local repo → project; list projects | FR-D26 | ✅ |
| PC.5 | `memory/mirror` + `memory/recall` using shared embed helpers | FR-D08, FR-D09, FR-D15 | ✅ |
| PC.6 | Engine tool `recall_project_memory` when linked; surface filter SHOULD | FR-D09, FR-D16 | ✅ |
| PC.7 | UI: view/edit what was mirrored (SHOULD) | FR-D10 | ✅ |
| PC.8 | Optional Bedrock proxy stream + usage ledger hook | NFR-D16, billing | ⏳ Deferred (local Bedrock remains default) |
| PC.9 | End-to-end: decision in IDE → recall in Web (and reverse) | FR-D27, UJ-D10 | ✅ Same `memory_entries` path |

**Exit:** Linked session recalls a preference stored from Web/Chrome without re-prompting. Unlinked Phase A behavior unchanged.

**Local verify:**
```bash
cd infra-backend && npm run migrate && npm run package:lambda:ide && npm run dev:ide
# Extension settings: walkcroach.ide.apiBaseUrl=http://localhost:3003
# F5 → Sign In / Paste Token → Link Project → recall_project_memory in panel
cd packages/agent-engine && npm test && npm run typecheck && npm run build
cd ../../ide && npm run typecheck && npm run build && npm run check:bundle
```

---

### Phase D — CLI companion (PRD Phase D) ✅ **IMPLEMENTED (local)**

**Depends on:** Phase A engine embeddable outside VS Code (hard gate — if engine is still tangled in `vscode` imports, refactor before CLI features).

| # | Task | Maps to | Status |
|---|------|---------|--------|
| PD.1 | `walkcroach` CLI package; same engine + HostAdapter | FR-D23 | ✅ `cli/` + `CliHostAdapter` |
| PD.2 | JSON output mode on every command | FR-D24 | ✅ `--json` NDJSON / command envelopes |
| PD.3 | Interactive approvals by default; `--non-interactive` / `--yes` documented for CI | FR-D25 | ✅ + `canNonInteractiveApprove` hard gates |
| PD.4 | Share auth + link config with extension (keychain / config file) | FR-D23 | ✅ `~/.walkcroach/` secrets + same BFF |
| PD.5 | macOS / Linux / Windows (WSL or native) smoke | NFR-D12 | ✅ Node 20+; `doctor` reports platform |
| PD.6 | CI example workflow calling CLI on a fixture repo | UJ-D9 | ✅ `cli/ci-example.yml` + fixture |
| PD.TUI | Ink TUI for visual parity with IDE panel | (product) | ✅ default on interactive TTY |

**Exit:** Same task completes in CLI as in extension against a fixture; JSON parseable; CI flag skips prompts safely only for non-infra tools.

**Local verify:**
```bash
cd packages/agent-engine && npm test && npm run build
cd ../../cli && npm install && npm test && npm run typecheck && npm run build
npm start -- doctor
npm start -- --plain run --cwd fixtures/sample-repo "ping"
# Interactive: npm start -- run "Add a comment to greet.ts"
```

---

## 10. Testing strategy

| Layer | What | Phase | Status |
|-------|------|-------|--------|
| Engine unit | Loop, approvals, truncation, skill matching, prompt order/cache markers | 0–A | ✅ `packages/agent-engine` |
| Host fake | In-memory fs + scripted approvals for CI | A | ✅ |
| Extension helpers | PKCE, ideClient, messageBridge | A | ✅ `ide` Vitest coverage |
| BFF (local) | Supertest IDE Lambda — health/401/anon reject; me + mirror/recall when CRDB | C | ✅ `ide-api.integration.test.ts` |
| BFF (deployed Test) | Cognito-shaped `Bearer dev:user:…` → me → link → mirror → recall | C | ✅ `tests/integration/ide-memory.integration.test.ts` |
| Cross-surface | Web `POST /projects` → IDE mirror → recall (same owner) | C | ✅ `tests/integration/cross-surface.integration.test.ts` |
| MCP/ccloud | Recorded fixtures + optional live against dev cluster | B | ✅ fixtures; live optional |
| VS Code UI E2E | Extension host / webview automation | — | ⬜ out of CI scope (API contracts cover Phase C) |

Do **not** log prompt bodies or SQL row data to CloudWatch.

---

## 11. Observability and success metrics

Align with PRD §10:

| Metric | Source |
|--------|--------|
| Activation: first approved action / install | Extension telemetry (opt-in) or demo checklist |
| Approve vs reject ratio | Engine events |
| `% sessions with recall_project_memory` | BFF + engine (Phase C) |
| MCP / ccloud / skills counts | Engine counters |
| Cross-surface link rate | `ide_project_links` |
| TTFT, cache hit rate | Local + optional BFF metrics |

---

## 12. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Temptation to use Chat Participant API under time pressure | Treat PRD §9 as binding; Phase 0 already commits to custom webview |
| Engine grown inside `ide/src` → CLI rewrite (Cline’s debt) | Phase 0 package boundary; CI fails if engine imports `vscode` |
| Weak vs Kiro in demos | Script a 30s cross-surface recall demo; lead with memory, not specs |
| Infra actions in YOLO mode | Hard-code ccloud exclusion from autonomy dial; tests assert it |
| Bedrock creds friction for users | Phase A: document AWS profile; Phase C: optional proxy |
| Sub-agent complexity | Feature-flag; defer before cutting approvals or MCP |
| Webview performance regression | Coalescing + bundle size budget in CI |
| Marketplace review delay | Start publisher verification early; ship Open VSX / VSIX sideload for hackathon judging if needed |

---

## 13. Suggested calendar (capacity-dependent)

Not a commitment — a sequencing aid against the Aug 18, 2026 hackathon:

| Window | Focus |
|--------|-------|
| Week 1 | Phase 0 + A1 |
| Week 2 | A2 + A3 (or flag sub-agents) |
| Week 3 | Phase B (MCP + skills + ccloud) — **hackathon differentiator** ✅ |
| Week 4 | Phase C thin BFF + cross-surface demo script ✅ |
| Stretch | Phase D CLI parity ✅ (+ Ink TUI) |

If only two weeks exist: **Phase A + B** beat Phase C for judging “CockroachDB tools in production use.” Cross-surface memory is the product moat but needs Web/Chrome data to shine — coordinate with those surfaces’ readiness.

---

## 14. Implementation principles (checklist for every PR)

1. **Local tools stay local; cloud stays thin.**  
2. **Engine has zero `vscode` imports.**  
3. **Stream first token; coalesce UI.**  
4. **Prompt cache prefix is sacred.**  
5. **Approvals default on; ccloud never auto.**  
6. **Skills are `SKILL.md`, not custom JSON.**  
7. **Memory writes are distilled, not chat logs.**  
8. **Same CRDB/Cognito — never a parallel brain.**  

---

## 15. References (research, July 2026)

- Cline SDK announcement (May 13, 2026): agent runtime extracted; CLI/Kanban first; IDE migrating — https://cline.bot/blog/introducing-cline-sdk-the-upgraded-agent-runtime  
- Continue architecture: core ↔ extension ↔ GUI; pass-through streaming — continuedev/continue docs / DeepWiki  
- Claude Code: prompt caching lessons; subagents; Agent Skills — Anthropic docs + engineering posts  
- Amazon Bedrock prompt caching + ConverseStream `cachePoint` — AWS docs  
- Kiro: spec-driven IDE/CLI, MCP, Powers — kiro.dev / AWS re:Post  
- CockroachDB Managed MCP, ccloud agent-ready CLI, Agent Skills — cockroachlabs.com agent-ready series  
- VS Code Webview performance: prefer state APIs over `retainContextWhenHidden`; coalesce postMessage (Kilo Code / Codex extension 2026 PRs)  
- Agent Skills open spec — agentskills/agentskills  

**Internal:** `walkcroach-ide-prd.md`, `walkcroach-chrome-implementation-plan.md` (“Platform stays shared. Surface adapter is new.”), `plan1.md`.
