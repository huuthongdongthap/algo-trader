# Algo-Trader Developer Onboarding Exploration Report
**Date**: 2026-03-27 | **Repo**: /home/user/algo-trader

---

## Executive Summary

The algo-trader codebase has **good foundational documentation** (README.md, SETUP.md) but significant **gaps in developer onboarding**. Key issues:

1. **.env.example is INCOMPLETE** — missing 27+ env vars actually used in code
2. **No CONTRIBUTING.md** — no dev workflow/standards for new contributors
3. **Intelligence setup unclear** — Python/FastAPI dependency not well integrated into main docs
4. **Path aliases not documented** — tsconfig has 6 path aliases without explanation
5. **CI/CD setup is minimal** — only type-check + test, no linting or pre-commit hooks
6. **Multiple env var inconsistencies** — different naming conventions across code

---

## Detailed Findings

### 1. ✅ `.env.example` — INCOMPLETE (Critical)

**Current state:**
- 10 variables listed (POLYMARKET_*, OLLAMA_*, DATABASE_PATH, PAPER_TRADING, CAPITAL_USDC, TELEGRAM_*)
- File at: `/home/user/algo-trader/.env.example`

**Reality check — Found 29 unique env vars in code:**
```
BOT_MODE, BOT_RUNNING, CAPITAL_USDC, CLAUDE_API_KEY
DB_PATH, DISCORD_WEBHOOK_URL, ETH_PRIVATE_KEY, ETH_RPC_URL
HISTORICAL_AVG_LOSS, HISTORICAL_AVG_WIN, HISTORICAL_WIN_RATE
LICENSE_DB_PATH, LICENSE_KEY, LICENSE_SECRET
LLM_CLOUD_DAILY_BUDGET, LLM_CLOUD_MODEL, LLM_CLOUD_URL
LLM_FALLBACK_MODEL, LLM_FALLBACK_URL
LLM_FAST_TRIAGE_MODEL, LLM_FAST_TRIAGE_URL
LLM_PRIMARY_MODEL, LLM_PRIMARY_URL
MAX_DRAWDOWN, MAX_LEVERAGE, MAX_MARKETS, MAX_OPEN_POSITIONS, MAX_POSITION_SIZE
MIN_CONFIDENCE, MIN_EDGE, NODE_ENV
OPENCLAW_AI_TRADING, OPENCLAW_BASE_URL, OPENCLAW_GATEWAY_URL, OPENCLAW_MODEL_STANDARD
PAPER_CAPITAL, POLYGON_RPC_URL
SCANNER_COOLDOWN_MS, SOLANA_PRIVATE_KEY
STOP_LOSS_PERCENT
USER_DB_PATH (also as ADMIN_EMAIL, RAAS_LICENSE_*, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
```

**Gaps in .env.example:**
- ✅ POLYMARKET_* — covered
- ✅ OLLAMA_HOST → documented but missing newer LLM_PRIMARY_URL/MODEL variants
- ✅ DATABASE_PATH → present (but called DB_PATH in code)
- ✅ PAPER_TRADING → present
- ✅ CAPITAL_USDC → present
- ✅ TELEGRAM → present
- ❌ **MISSING**: All risk config (MAX_*, MIN_*, STOP_LOSS_*, MAX_DRAWDOWN, MAX_LEVERAGE)
- ❌ **MISSING**: All LLM routing vars (LLM_PRIMARY_*, LLM_FAST_TRIAGE_*, LLM_FALLBACK_*, LLM_CLOUD_*, CLAUDE_API_KEY)
- ❌ **MISSING**: Trading feature flags (OPENCLAW_AI_TRADING, BOT_MODE, BOT_RUNNING, PAPER_CAPITAL)
- ❌ **MISSING**: License/Auth (LICENSE_KEY, LICENSE_SECRET, LICENSE_DB_PATH, ADMIN_EMAIL, USER_DB_PATH)
- ❌ **MISSING**: Optional exchanges (ETH_RPC_URL, SOLANA_PRIVATE_KEY, DISCORD_WEBHOOK_URL)
- ❌ **MISSING**: Historical metrics (HISTORICAL_WIN_RATE, HISTORICAL_AVG_WIN, HISTORICAL_AVG_LOSS)
- ❌ **MISSING**: Scan config (SCANNER_COOLDOWN_MS)

**Additional issue**: Naming inconsistency
- `.env.example` uses `OLLAMA_*` prefix
- Code uses `LLM_PRIMARY_*`, `LLM_FAST_TRIAGE_*`, `LLM_FALLBACK_*` (newer pattern)
- `.env.production` references `LLM_*` pattern

**Files involved:**
- `/home/user/algo-trader/.env.example` (incomplete)
- `/home/user/algo-trader/src/config/llm-config.ts` (defines LLM routes with many optional vars)
- `/home/user/algo-trader/src/agents/risk-agent.ts` (reads MAX_*, MIN_*, STOP_LOSS_*, etc.)
- `/home/user/algo-trader/docker/docker-compose.cashclaw.yaml` (shows correct LLM_PRIMARY_URL pattern)

---

### 2. ❌ `README.md` — Partial Coverage

**Current state:**
- ✅ 9909 bytes, well-structured
- ✅ Features, CLI commands, architecture diagram
- ✅ Quick Start (5 commands) — but skips env var explanation

**Gaps:**
- ✅ Quick Start mentions `cp .env.example .env` but doesn't explain what vars are needed
- ❌ No dev dependencies installation guide (Node version, pnpm, TypeScript)
- ❌ No local testing/development workflow
- ❌ No troubleshooting for "which env vars do I need?"
- ❌ Link mentions "25 CLI commands" but CLI section only shows ~15
- ❌ No mention of intelligence sidecar setup for dev

**Related:** SETUP.md exists (10,439 bytes) — very detailed for production but overly focused on M1/Ollama setup. Should split dev vs. production workflows.

---

### 3. ❌ No `CONTRIBUTING.md`

**Critical gap:** No file exists at repo root.

**What's missing:**
- ❌ How to set up dev environment
- ❌ Code style guidelines (TypeScript strict mode, module naming, etc.)
- ❌ Testing requirements before PR
- ❌ Git workflow (branch naming, commit conventions)
- ❌ How to run linting/type-check locally
- ❌ Where to ask questions (Discord, Issues, etc.)

**What exists instead:**
- `docs/code-standards.md` (exists! — but not linked from README or root)
  - 3,724 bytes
  - Covers TypeScript best practices, testing, commit conventions
- `SETUP.md` (10,439 bytes) — setup, not contribution
- `AGENTS.md` (2,192 bytes) — agent registry, not dev guide
- `CLAUDE.md` (3,976 bytes) — Claude AI integration, not dev guide

---

### 4. ❌ `intelligence/` Setup — Underdocumented

**Current state:**
- Directory: `/home/user/algo-trader/intelligence/`
- Contains: `README.md`, `setup.sh`, `server.py`, `.env`, `com.cashclaw.alphaear.plist`

**Issues:**
1. ✅ README.md explains architecture and endpoints
2. ❌ **setup.sh requires bash execution** — no step-by-step guide in main docs
3. ❌ **Hidden git dependency** — clones `Awesome-finance-skills` repo during setup (not documented)
4. ❌ **Python + pip deps not in main pnpm workflow** — separate installation process
5. ❌ **No integration with main README** — intelligence setup is buried in SETUP.md Phase B
6. ❌ **FastAPI server (:8100) not mentioned in quick start**

**Related files:**
- `/home/user/algo-trader/intelligence/setup.sh` — clones skills repo, links modules
- `/home/user/algo-trader/intelligence/server.py` — FastAPI server
- `/home/user/algo-trader/src/intelligence/alphaear-client.ts` — TypeScript wrapper
- Docker compose uses: `ALPHAEAR_SIDECAR_URL=http://host.docker.internal:8100`

---

### 5. ❌ `package.json` Scripts — Minimal

**Current scripts:**
```json
"start": "npx tsx src/cli/index.ts",
"build": "npx tsc",
"check": "npx tsc --noEmit",
"test": "vitest run",
"test:watch": "vitest",
"postinstall": "pnpm rebuild better-sqlite3"
```

**Missing common dev scripts:**
- ❌ `lint` — no ESLint or linting setup detected
- ❌ `format` — no Prettier or code formatter
- ❌ `dev` — no watch mode for TypeScript compilation
- ❌ `typecheck` — aliased as `check`, but not conventional
- ❌ `test:coverage` — no coverage reporting visible
- ❌ `seed` or `db:init` — no database initialization
- ❌ `intelligence` or `intelligence:dev` — separate Python setup, not npm-integrated

**What's not documented:**
- When should dev run `pnpm check` vs `pnpm build`?
- Is linting/formatting enforced before commit? (No .husky or pre-commit hooks visible)

---

### 6. ✅ Docker & docker-compose.cashclaw.yaml — Good Env Var Docs

**Current state:**
- File at: `/home/user/algo-trader/docker/docker-compose.cashclaw.yaml`
- Shows **correct environment variables** for production
- Lists all LLM routing, trading config, timezone

**Positives:**
- ✅ Comments explain each section
- ✅ Env vars match actual code usage (LLM_PRIMARY_*, etc.)
- ✅ Health check defined
- ✅ Volume strategy documented (named volume, not bind mount)

**But exposed gap:** This file uses the RIGHT env vars, but `.env.example` doesn't match. Developers copying from .env.example won't understand the LLM_PRIMARY_* pattern.

---

### 7. ❌ `tsconfig.json` Path Aliases — Undocumented

**Current aliases:**
```json
"@core/*": ["src/core/*"],
"@polymarket/*": ["src/polymarket/*"],
"@cex/*": ["src/cex/*"],
"@dex/*": ["src/dex/*"],
"@strategies/*": ["src/strategies/*"],
"@data/*": ["src/data/*"],
"@cli/*": ["src/cli/*"]
```

**Issues:**
- ❌ No documentation on when to use which alias
- ❌ No reference in README or docs/
- ❌ No explanation of the architecture these imply
- ❌ No guidance on adding new aliases

**What a dev would need to know:**
- Are these aliases mandatory or optional?
- Can I import `src/core/config.ts` directly or must I use `@core/config`?
- Should new modules get their own alias?

---

### 8. ✅/.github/workflows CI/CD — Minimal Setup

**Current state:**
- File: `/home/user/algo-trader/.github/workflows/ci.yml` (660 bytes)
- Steps:
  1. Checkout
  2. Setup pnpm
  3. Setup Node 22.x
  4. Install deps
  5. Type check
  6. Run tests (vitest)

**Positives:**
- ✅ Type checking enforced
- ✅ Tests required
- ✅ pnpm lock file strict (`--frozen-lockfile`)

**Gaps:**
- ❌ No linting step (ESLint, Prettier check, etc.)
- ❌ No build verification (`pnpm build`)
- ❌ No security scanning
- ❌ No pre-commit hooks documented (`.husky`, `lint-staged`)
- ❌ Deploy workflow exists but is empty/minimal

**Related files:**
- `/home/user/algo-trader/.github/workflows/deploy.yml` (1,549 bytes) — deployment only

---

### 9. ✅ `docs/` Directory — Rich but Scattered

**Documents exist (12 files):**
```
BINH_PHAP_TRADING.md        (15.4 KB) — Vietnamese trading strategies
api-reference.md            (12.6 KB) — REST API endpoints
code-standards.md           (3.7 KB)  — ✅ CODE STANDARDS (should be CONTRIBUTING.md)
codebase-summary.md         (15.2 KB) — File structure + modules
customer-deployment-sop.md  (14.1 KB) — Customer setup (duplicate of SETUP.md?)
deployment-guide.md         (6.6 KB)  — Local setup instructions
index.md                    (8.8 KB)  — Doc index
project-overview-pdr.md     (9.4 KB)  — Vision, goals, pricing
sdk-quickstart.md           (13.6 KB) — SDK usage
system-architecture.md      (9.6 KB)  — Component interaction
trading-performance.md      (2.1 KB)  — Trade metrics
vps-deployment-guide.md     (2.5 KB)  — Ubuntu VPS setup
```

**Issues:**
- ✅ Rich content exists
- ❌ **Not linked from main README** — users don't know docs/ exists!
- ❌ **Scattered info** — contributing guidelines buried in `code-standards.md`
- ❌ **Duplicates** — `SETUP.md` (root) vs `customer-deployment-sop.md` (docs/) vs `deployment-guide.md` (docs/)
- ❌ **No developer quick start** — index.md points to too many places

**Missing:**
- ❌ **Getting Started for Developers** — separate from customer deployment
- ❌ **Troubleshooting** — local dev issues
- ❌ **Architecture Decisions** — why certain patterns chosen

---

## Summary Table: Onboarding Gaps

| Item | Status | Severity | Notes |
|------|--------|----------|-------|
| `.env.example` completeness | ❌ 28% | **CRITICAL** | Missing 27 env vars; inconsistent naming |
| README.md dev workflow | ✅/❌ | MEDIUM | Has quick start but no "what vars do I need?" |
| CONTRIBUTING.md | ❌ | **CRITICAL** | Doesn't exist; code-standards.md buried in docs/ |
| intelligence/ integration | ❌ | HIGH | Separate Python setup; not npm-integrated |
| package.json scripts | ❌ | MEDIUM | Missing dev, lint, format scripts |
| docker-compose examples | ✅ | LOW | Correct env vars but not matched in .env.example |
| Path aliases docs | ❌ | MEDIUM | 6 aliases exist but not documented |
| CI/CD completeness | ❌ | MEDIUM | No linting, no pre-commit hooks |
| docs/ organization | ✅/❌ | MEDIUM | Content exists but not discoverable; duplicates |
| Node/pnpm versions | ✅ | LOW | `.nvmrc` = 22, `.node-version` = 22 (clear) |

---

## Recommended Fixes (Priority Order)

### P0 — Critical (Block new developers)
1. **Update `.env.example`** to include ALL 29 env vars with defaults and descriptions
2. **Create `CONTRIBUTING.md`** at repo root linking to or duplicating code-standards.md
3. **Update main README.md** with dev workflow section + link to CONTRIBUTING.md

### P1 — High (Prevent confusion)
4. **Create `DEVELOPING.md`** (standalone) explaining:
   - Dev vs. production setup (split from SETUP.md)
   - intelligence/ setup with npm integration
   - How to run tests, type-check, format
   - Troubleshooting section
5. **Add npm scripts** for `dev`, `lint`, `format`
6. **Integrate intelligence/ setup** into pnpm workflow or document clearly

### P2 — Medium (Polish)
7. **Document path aliases** in README or create `ARCHITECTURE.md`
8. **Add pre-commit hooks** (.husky/lint-staged) and document in CONTRIBUTING.md
9. **Consolidate docs/** (remove duplicates, add index to main README)
10. **Add troubleshooting guide** covering common setup issues

---

## Files to Create/Modify

| Path | Action | Purpose |
|------|--------|---------|
| `.env.example` | **MODIFY** | Add all 29 env vars with descriptions |
| `CONTRIBUTING.md` | **CREATE** | Developer workflow + code standards |
| `DEVELOPING.md` | **CREATE** | Dev setup (separate from production SETUP.md) |
| `README.md` | **MODIFY** | Add dev workflow, link CONTRIBUTING.md, intelligence note |
| `docs/ARCHITECTURE.md` | **CREATE** | Explain path aliases, module structure |
| `docs/TROUBLESHOOTING.md` | **CREATE** | Common setup issues + fixes |
| `package.json` | **MODIFY** | Add dev, lint, format scripts |
| `.husky/` | **CREATE** | Pre-commit hooks for type-check |
| `SETUP.md` | **REFACTOR** | Split dev vs. prod; link to DEVELOPING.md |

---

## Questions Left Unanswered (For Owner)

1. **Naming convention**: Should we standardize on `LLM_*` vs `OLLAMA_*`? Current code uses `LLM_*` but `.env.example` uses `OLLAMA_*`.
2. **intelligence/ scope**: Is AlphaEar sidecar mandatory for all developers, or optional?
3. **Linting/formatting**: Why no ESLint/Prettier? Should we add them?
4. **Pre-commit hooks**: Should commits run `pnpm check` automatically?
5. **Dev database**: Should there be a seed script for SQLite?
6. **License key**: How do new developers get LICENSE_KEY/LICENSE_SECRET locally?

---

**Report Generated**: 2026-03-27 | **Thoroughness**: Medium | **Estimated Fix Time**: 4-6 hours
