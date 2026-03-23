# AlgoTrade — Phase 1 Intelligence Report
**Date:** 2026-03-23 | **Stage:** Zero → PSF | **Author:** planner

---

## 1. SWOT Analysis

### Strengths
- **411 TS files, mature codebase** — full stack (CLOB client, Kelly sizer, paper trading, billing, monitoring, resilience) built before a single trade. Rare discipline.
- **2396/2398 tests passing (99.9%)** — unusually high coverage for a pre-revenue project. Engine is mechanically sound.
- **Polymarket CLOB client** — ECDSA signing, WebSocket orderbook streaming, order management already wired.
- **OpenClaw LLM router** — 3-tier routing (simple/standard/complex) with MLX local inference on M1 Max. Zero per-call inference cost.
- **Kelly half-sizer** — position sizing discipline baked in; risk manager with drawdown limits already enforced.
- **Polar.sh billing live** — subscription infrastructure already integrated. Day-1 monetization-ready.
- **Paper trading module exists** — `PaperExchange`, `PaperPortfolio`, `PaperSession` all present.
- **SQLite schema operational** — trades, positions, pnl_snapshots, ai_decisions tables exist (0 rows, but schema correct).
- **Correct strategic focus** — explicitly NOT HFT/MM (where 73% arb captured by sub-100ms bots). Targeting information quality edge on long-tail markets where LLM latency (500ms–2s) is irrelevant.

### Weaknesses
- **0 trades executed** — all code, no signal validation. "Engine trustworthy" = unproven claim.
- **0 API keys configured** — `POLYMARKET_PRIVATE_KEY`, `BINANCE_API_KEY`, `BYBIT_API_KEY` all EMPTY. Can't paper trade against live data without Polymarket credentials.
- **2 failing tests (openclaw-config.test.ts)** — test expects default models `llama3.1:8b` / `deepseek-r1:32b/70b`; actual defaults are `mlx-community/Qwen2.5-Coder-32B-Instruct-4bit`. Mismatch = stale tests, not broken code. Minor but breaks 100% green.
- **No paper trade data** — 0 rows in `trades` table. Phase 1 exit criteria (50 paper trades) not started.
- **OpenClaw model mismatch** — config defaults changed to MLX Qwen models but tests still expect Ollama model IDs. Suggests OpenClaw was migrated but tests not updated.
- **No long-tail market scanner yet** — company blueprint lists this as Phase 1 Task 3. Not confirmed built.
- **`0xpaper-key` hardcoded in tests** — test pipeline failure log shows `TypeError: invalid BytesLike value (argument="value", value="0xpaper-key")` — paper wallet key is not a valid private key format in some test paths.
- **TypeScript compiles clean** — `npx tsc --noEmit` returned 0 errors. Zero debt here.

### Opportunities
- **Polymarket $2B+/week volume** — liquid enough for retail-scale ($500–$10K) trades with meaningful edge.
- **Long-tail market inefficiency** — sub-$100K volume markets have wider spreads and less sophisticated participants. LLM information edge has highest alpha here.
- **RaaS recurring revenue** — 700 subscribers at blended ~$120/mo = $1M ARR. Achievable if product-market fit exists.
- **"We eat our own cooking" trust signal** — showing own-account P&L as lead magnet is a powerful distribution differentiator vs. black-box competitors.
- **OpenClaw MLX is free inference** — M1 Max running Qwen locally = $0/inference cost = better unit economics than OpenAI-dependent competitors.
- **Open source engine + closed RaaS** — classic OSS moat. Community validates engine quality; revenue from hosted/managed service.
- **Kalshi module present** — second prediction market venue already partially built. Diversification path exists.

### Threats
- **Edge may not materialize** — LLM calibration on binary prediction markets is unproven. Confidence ≠ accuracy. If OpenClaw isn't better-calibrated than market implied probability, the entire thesis fails.
- **Polymarket ToS** — automated trading may require explicit approval. Not verified. Account suspension risk before any revenue.
- **HFT on popular markets** — thesis correctly avoids this, but new traders often migrate to higher-volume markets when "edge" feels thin on long-tail. Discipline risk.
- **CFTC regulatory risk** — Polymarket blocked US IPs in 2023. Operating from Vietnam reduces US exposure but VPN/proxy rules could change.
- **Solo dev + AI agents** — no human team to catch strategic drift, debug production incidents at 3am, or handle subscriber support at scale.
- **Crypto volatility** — Polygon gas fees, USDC depeg risk, smart contract bugs in Polymarket CLOB. These are external risks beyond the trading edge.

---

## 2. Five-Factor Venture Terrain Assessment

### Factor 1: Market Size
- **TAM:** Global algorithmic trading software market ~$18.8B (2025). Prediction market subset = small but fast-growing.
- **SAM:** Crypto-savvy retail traders who actively use Polymarket/Kalshi = ~50K–200K globally. At $150 ARPU = $7.5M–$30M SAM.
- **SOM (12-month):** Realistic 700 subscribers at ~$120 blended = $1M ARR. Captures ~3–13% of SAM lower bound.
- **Verdict:** Market is not huge, but $1M ARR target is achievable within SAM. Not a VC-scale opportunity; right-sized for indie/bootstrapped.

### Factor 2: Competition
- **Hummingbot** — open source, focused on CEX/DEX market making and grid trading. Not prediction markets. Different ICP.
- **3Commas / Pionex** — CEX bots, DCA/grid. No Polymarket integration. Different asset class.
- **Polymarket bots (informal)** — exist but mostly arbitrage-focused or simple trend-following. No known product offering LLM-based signal + managed execution + subscription tier.
- **Kalshi Pro** — exchange's own tools, not third-party bot.
- **Verdict:** Direct competition is thin for AI-powered prediction market RaaS. The niche is genuinely underserved. First-mover advantage available *if* edge validates.

### Factor 3: Team
- Solo developer + AI agents (mekong-cli orchestration).
- Strength: 411 files built solo = high execution velocity.
- Weakness: No human co-founder for strategy review, no operator for monitoring, no growth/marketing resource.
- Critical gap: If trading edge validates and subscribers arrive, support + ops burden hits one person.
- **Verdict:** Sufficient for PSF phase. Will become bottleneck at PMF+ (50+ subscribers).

### Factor 4: Product Readiness
- Code exists: HIGH readiness on infrastructure.
- Trades executed: ZERO. No empirical validation.
- Paper trading module: Built but never run.
- OpenClaw signal loop: Module exists (`ai-signal-generator.ts`), not end-to-end tested in live context.
- API keys: None configured.
- **Verdict:** T-minus 2 weeks from first paper trade if API keys configured today. Product is 80% done; the missing 20% (live market scan → LLM signal → paper order) is the most critical 20%.

### Factor 5: Unit Economics
- Infrastructure cost (M1 Max local): ~$0 inference, ~$50/mo electricity premium.
- Polymarket gas (Polygon): ~$0.01–0.05/tx at current gas prices. 50 trades/week = ~$0.50–$2.50/week.
- Polar.sh fee: 5% of revenue.
- Break-even: ~2 Starter subscribers ($98/mo) covers infra. Extremely lean.
- At 700 subscribers (blended $120): ~$84K MRR gross, ~$80K net of Polar fees.
- Own-account trading P&L: Bonus revenue stream; not in subscription model. With $10K bankroll at Sharpe > 1.5, realistic monthly alpha ~$300–800 (3–8% on long-tail markets).
- **Verdict:** Unit economics are excellent once subscription revenue starts. Near-zero marginal cost per subscriber (local LLM, no API bills). Main cost is solo dev time.

---

## 3. Technical Audit

### TypeScript Compilation
```
npx tsc --noEmit → 0 errors
```
Clean. No debt here.

### Test Results
```
Test Files: 1 failed | 157 passed (158)
Tests: 2 failed | 2396 passed (2398)
```

**2 failing tests — both in `tests/openclaw/openclaw-config.test.ts`:**
- `should return defaults when no env vars set` — expects `llama3.1:8b` as simple model default; actual is `mlx-community/Qwen2.5-Coder-32B-Instruct-4bit`
- `should allow partial env overrides` — same model name mismatch
- **Root cause:** OpenClaw was migrated from Ollama model IDs to MLX Qwen model IDs, but test assertions were not updated.
- **Fix:** 2-line change in test file. Not a code bug.

**Secondary test noise (not failures):**
- `process-wiring.test.ts` — intentional error throwing for signal handler tests (expected behavior, logs look alarming but tests pass)
- `0xpaper-key` TypeError — in test fixtures using fake private key strings; ethers.js validation rejects them. Tests still pass but log errors.

### API Keys Status
| Key | Status | Blocker? |
|-----|--------|---------|
| `POLYMARKET_PRIVATE_KEY` | EMPTY | YES — blocks paper trading |
| `BINANCE_API_KEY` | EMPTY | NO (CEX not Phase 1 focus) |
| `BYBIT_API_KEY` | EMPTY | NO |
| `POLAR_API_TOKEN` | SET | NO (billing works) |
| `POLYGON_RPC_URL` | SET | Partial (RPC configured, no signing key) |

### Database State
- SQLite at `data/algo-trade.db` — schema present (10 tables)
- `trades` table: **0 rows**
- `positions` table: likely 0 rows
- All paper trading infrastructure idle

### Top 3 Blockers to First Paper Trade

**Blocker 1: No Polymarket API credentials (CRITICAL)**
- Paper trading against live Polymarket orderbook requires API key + wallet.
- Get credentials: https://docs.polymarket.com/ → CLOB API key generation.
- Use a paper wallet (new keypair, no real funds needed for read-only market data).
- Estimated time to unblock: 30 minutes.

**Blocker 2: OpenClaw signal loop not end-to-end wired (CRITICAL)**
- `ai-signal-generator.ts` exists but no confirmed working pipeline: `market scan → LLM prompt → probability estimate → edge calculation → paper order`.
- The blueprint lists this as Phase 1 Task 4 (not done).
- `openclaw-config.ts` defaults point to `localhost:11435/v1` — OpenClaw must be running locally on port 11435 for the loop to work.
- Estimated time to unblock: 1–3 days (wiring + prompt tuning).

**Blocker 3: Long-tail market scanner not confirmed built (HIGH)**
- Phase 1 Task 3: filter Polymarket markets by `volume < $100K`, `resolution 7-30 days`, `open` status.
- No file named `market-scanner`, `long-tail-scanner`, or similar found in `src/polymarket/` (not verified in depth).
- Without this filter, signal loop has no qualified input universe.
- Estimated time to build: 2–4 hours if Polymarket CLOB client already supports market listing.

---

## Summary Verdict

AlgoTrade is a well-engineered engine with zero empirical validation. The strategic thesis is sound (information edge > speed edge on long-tail prediction markets), the unit economics are excellent (local LLM, near-zero marginal cost), and the competitive landscape is thin. The code is 80% complete.

The missing 20% is everything that matters: a working signal, a real trade, a proven edge.

**Priority order for this week:**
1. Get Polymarket API credentials → configure `.env`
2. Fix 2 failing tests (10 minutes)
3. Verify/build long-tail market scanner
4. Wire OpenClaw signal loop end-to-end
5. Run 50 paper trades, log predicted vs actual probabilities
6. Measure edge: if OpenClaw estimate deviates >5% from market implied probability on >20% of scanned markets → proceed to Phase 2 live trading

No new code needed until the existing engine has executed its first trade.

---

## Unresolved Questions

1. Which OpenClaw model (Qwen 32B MLX vs DeepSeek 70B) gives better calibration on binary prediction markets? — Must empirically test on paper trade data.
2. Is automated Polymarket trading allowed under current ToS? — Must verify before Phase 2 live trading.
3. Does `src/polymarket/` have an existing market scanner that can filter by volume/resolution? — Not confirmed; needs code review.
4. `0xpaper-key` in test fixtures — is there a canonical paper wallet pattern for integration tests, or should tests mock the signing layer?
5. Gas cost sustainability: $1K bankroll on Polygon at 50 trades/week — need gas estimate before committing Phase 2 capital.
