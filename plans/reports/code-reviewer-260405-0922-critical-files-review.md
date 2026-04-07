# Code Review: Critical Files — Recent Commits

**Date:** 2026-04-05
**Scope:** 8 critical files across commits 972ee24..a9035ad (last ~10 commits)
**Score: 7.5 / 10**

---

## Critical Issues

### C1. SSRF via `/news/content` endpoint — no URL validation
**File:** `intelligence/server.py:193-203`
**Impact:** Attacker can pass `url=http://169.254.169.254/...` to read cloud metadata, internal services, or localhost endpoints. The `ContentRequest` model accepts any string as URL with zero validation.
**Fix:** Validate URL scheme (https only), block private/link-local IP ranges, and restrict to known news domains or use an allowlist.

```python
from urllib.parse import urlparse
BLOCKED_HOSTS = {'localhost', '127.0.0.1', '169.254.169.254', 'metadata.google.internal'}

class ContentRequest(BaseModel):
    url: str
    @validator('url')
    def validate_url(cls, v):
        parsed = urlparse(v)
        if parsed.scheme not in ('http', 'https'):
            raise ValueError('Invalid scheme')
        if parsed.hostname in BLOCKED_HOSTS or parsed.hostname.startswith('10.'):
            raise ValueError('Blocked host')
        return v
```

### C2. `isAdmin()` prefix bypass — any key starting with `admin_` grants admin
**File:** `src/admin/admin-auth.ts:76-81`
**Impact:** If an attacker registers or obtains any API key prefixed `admin_`, they get full admin access. Convention-based admin detection is unsafe.
**Fix:** Remove the prefix check; admin status should only come from comparing against `ADMIN_SECRET` or a role field in the user store.

```typescript
export function isAdmin(apiKey: string): boolean {
  const adminSecret = process.env['ADMIN_SECRET'];
  return !!adminSecret && timingSafeEqual(apiKey, adminSecret);
}
```

---

## High Priority

### H1. `trackSignal` regex JSON parse — fragile and exploitable
**File:** `src/intelligence/alphaear-client.ts:137`
**Impact:** `resp.analysis.match(/\{[^}]+\}/)` only matches single-level JSON (no nested braces). If the LLM returns `{"reasoning": "price {dropped}"}`, the regex breaks. Also no schema validation on parsed result — the cast to `SignalEvolution` is unchecked.
**Fix:** Use a proper JSON extractor (find first `{` to last `}`) and validate with a type guard.

### H2. FinBERT signals mis-labeled as `source: 'newsapi'`
**File:** `src/data/sentiment-feed.ts:158,173`
**Impact:** FinBERT signals are tagged `source: 'newsapi'` ("closest existing source type" per comment). This corrupts downstream analytics — any filtering or weighting by source treats FinBERT results as NewsAPI data. The `SentimentSignal.source` union type doesn't include `'finbert'`.
**Fix:** Add `'finbert'` to the `SentimentSignal.source` union and use it.

### H3. No input size limits on Python sidecar batch endpoints
**File:** `intelligence/server.py:219-229`
**Impact:** `BatchSentimentRequest.texts` and `ForecastRequest.prices` have no max length. An attacker can send 100k texts to OOM the FinBERT process or 1M prices to crash Kronos.
**Fix:** Add `max_items` validators:
```python
class BatchSentimentRequest(BaseModel):
    texts: List[str] = Field(..., max_items=100)
```

### H4. Cloud spend tracking is in-memory only, resets on restart
**File:** `src/lib/llm-router.ts:177-179`
**Impact:** `cloudSpendToday` resets to 0 on every process restart. If the bot restarts mid-day, the daily budget guard is bypassed, leading to unbounded cloud API spend.
**Fix:** Persist daily spend to SQLite or a file. At minimum, log a warning on startup about spend tracking reset.

### H5. `cancelAllOpen` sequential — slow under load
**File:** `src/polymarket/order-manager.ts:76-91`
**Impact:** Cancels orders one-by-one in a loop. During shutdown with 50+ open GTC orders and 30s grace period, some orders may not cancel in time.
**Fix:** Use `Promise.allSettled` for parallel cancellation (the CLOB API supports concurrent requests):
```typescript
const results = await Promise.allSettled(open.map(o => this.cancelOrder(o.id)));
return results.filter(r => r.status === 'fulfilled' && r.value).length;
```

---

## Medium Priority

### M1. `classifyMarketCategory` regex injection on short keywords
**File:** `src/polymarket/polymarket-fee-calculator.ts:108`
**Impact:** Keywords like `'sol'`, `'eth'`, `'ai '` are used in `new RegExp(...)` without escaping. Currently safe (all alphanumeric), but if a keyword with regex metacharacters is added later (e.g., `s&p`), it will throw or misclassify. The `s&p` keyword at line 85 is only matched via `includes()` (>4 chars), but this is fragile.
**Fix:** Escape regex special chars: `kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`

### M2. Python sidecar exposes raw exception messages in 500 responses
**File:** `intelligence/server.py:177,189,228,252,293`
**Impact:** `raise HTTPException(500, str(e))` leaks internal error details (file paths, stack frames, DB schema) to callers. Information disclosure risk.
**Fix:** Log the full error server-side, return generic message to client:
```python
logger.exception(f"Error in {endpoint}")
raise HTTPException(500, "Internal processing error")
```

### M3. No rate limiting on Python sidecar
**File:** `intelligence/server.py` (entire file)
**Impact:** Sidecar binds to `0.0.0.0:8100` with no auth and no rate limiting. Any process on the host can spam it. Combined with SSRF (C1), this is an amplification vector.
**Fix:** Add `slowapi` rate limiter or bind to `127.0.0.1` only.

### M4. `AlphaEarClient.extractContent` passes user URL without sanitization
**File:** `src/intelligence/alphaear-client.ts:89-91`
**Impact:** The TS client forwards any URL string to the sidecar `/news/content` endpoint. If called with user-supplied input, this is SSRF-by-proxy. Need validation on both client and server side.

### M5. Duplicate `// Aggregator` comment block
**File:** `src/data/sentiment-feed.ts:146-147` and `184-185`
**Impact:** Dead comment; looks like a copy-paste artifact. Minor readability issue.

### M6. `netProfitMaker` uses `maxTakerFee` unconditionally
**File:** `src/polymarket/polymarket-fee-calculator.ts:75-77`
**Impact:** The rebate calculation always uses `maxTakerFee` regardless of probability. This overestimates maker rebates. Should use the average expected taker fee or accept a probability parameter.

---

## Low Priority

### L1. `.env.example` comments out `CLAUDE_API_KEY` with prefix visible
**File:** `.env.example:33`
**Impact:** Shows `sk-ant-...` prefix — minor, but could guide attackers to target Anthropic keys specifically. Trivial risk.

### L2. `lastHealthCheck` comparison uses 5-minute window without config
**File:** `src/intelligence/alphaear-client.ts:165`
**Impact:** Hardcoded 300_000ms health staleness threshold. Not configurable. Fine for now, but should match the router's `healthCheckIntervalMs` pattern.

### L3. Docker healthcheck hits host network from container
**File:** `docker/docker-compose.cashclaw.yaml:62-64`
**Impact:** Healthcheck reaches `host.docker.internal` — will fail if host firewall blocks container traffic. Not a bug per se, just a deployment fragility.

### L4. `timingSafeEqual` in admin-auth is custom implementation
**File:** `src/admin/admin-auth.ts:21-28`
**Impact:** Node.js provides `crypto.timingSafeEqual` which is audited and constant-time at the C++ level. Custom JS implementation may be optimized away by V8. Use the stdlib version with Buffer conversion.

---

## Positive Observations

- **Graceful degradation throughout** — AlphaEar client, LLM router, and sentiment feed all degrade gracefully when backends are unavailable
- **Good abort/timeout discipline** — `AbortSignal.timeout()` used consistently across all HTTP calls
- **Fee calculator is well-structured** — clear types, clamped math, no floating-point traps
- **Admin auth uses constant-time comparison** — good security awareness (even if custom impl)
- **Docker compose uses named volumes** — avoids VirtioFS corruption on macOS, proper logging limits
- **Paper trading default** — `.env.example` defaults to `PAPER_TRADING=true`, safe onboarding
- **Secrets externalized** — `env_file: secrets/.env.cashclaw` kept separate from compose file

---

## Metrics

| Metric | Value |
|--------|-------|
| Files reviewed | 8 core + 2 supporting |
| Critical issues | 2 |
| High issues | 5 |
| Medium issues | 6 |
| Low issues | 4 |

---

## Recommended Actions (Priority Order)

1. **Fix SSRF (C1)** — URL validation on sidecar `/news/content`
2. **Fix admin prefix bypass (C2)** — remove `admin_` prefix convention
3. **Add batch size limits (H3)** — prevent OOM on sidecar
4. **Fix source label (H2)** — add `'finbert'` source type
5. **Parallelize cancellation (H5)** — `Promise.allSettled` for shutdown
6. **Persist cloud spend (H4)** — survive restarts
7. **Sanitize error responses (M2)** — stop leaking internals

---

## Unresolved Questions

1. Is the sidecar intended to be reachable only from the Docker container, or also from external hosts? If Docker-only, binding to `127.0.0.1` + `host.docker.internal` would mitigate M3.
2. Is `classifyMarketCategory` used with user-supplied text, or only with Polymarket API responses? Determines urgency of M1.
3. Is there a plan to add authentication to the sidecar HTTP endpoints? Currently fully open.
