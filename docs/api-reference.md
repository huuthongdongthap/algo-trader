# API Reference

API documentation for the Algo-Trade RaaS platform. All endpoints return JSON and support native TypeScript via the SDK.

## Overview

The Algo-Trade API provides remote control of algorithmic trading strategies, portfolio monitoring, billing integration, and system health checks. No framework dependencies — pure Node.js HTTP.

**Base URL:** `https://api.algo-trade.io` (production) or `http://localhost:3000` (local)

## Authentication

Two authentication methods are supported:

### Bearer JWT Tokens

For session-based authentication:

```
Authorization: Bearer <jwt_token>
```

JWT tokens expire after 1 hour by default. Create tokens server-side using your secret:

```typescript
import { createJwt } from '@algo-trade/sdk';

const token = createJwt(
  { id: 'user123', email: 'user@example.com', tier: 'pro' },
  process.env.JWT_SECRET,
  3600 // 1 hour
);
```

### API Keys

For service-to-service or long-lived access:

```
Authorization: ApiKey <your_api_key>
```

Or legacy header:

```
X-API-Key: <your_api_key>
```

API keys are 32-byte hex strings managed per user in the user store. Request a key from your account dashboard or create via the user management API.

**Public endpoints** (no auth required):
- `GET /api/health`
- `POST /api/webhooks/polar` (HMAC verified)

## Rate Limiting

Requests are rate-limited by subscription tier using a sliding 60-second window:

| Tier | Limit | Window |
|------|-------|--------|
| Free | 10 req/min | 60s |
| Pro | 100 req/min | 60s |
| Enterprise | 1000 req/min | 60s |

Rate limit status is returned in response headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
Retry-After: 5
```

When limit is exceeded, the server responds with:

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Retry after 5s.",
  "retryAfter": 5
}
```

HTTP Status: `429`

## System Endpoints

### GET /api/health

Health check endpoint. No authentication required.

**Response** (200 OK):

```json
{
  "status": "ok",
  "uptime": 3600000,
  "db": "ok",
  "pipeline": "running",
  "wsClients": 42,
  "version": "0.1.0"
}
```

| Field | Type | Description |
|-------|------|-------------|
| status | string | "ok", "degraded", or "down" |
| uptime | number | Milliseconds since server start |
| db | string | "ok" or "error" |
| pipeline | string | "running" or "stopped" |
| wsClients | number | Active WebSocket connections |
| version | string | Server version |

**Example:**

```bash
curl -X GET http://localhost:3000/api/health
```

---

### GET /api/metrics

Prometheus-format metrics endpoint. No authentication required.

**Response** (200 OK):

Plain text Prometheus format:

```
# HELP algo_trades_total Total trades executed by strategy and outcome
# TYPE algo_trades_total counter
algo_trades_total{strategy="grid-trading",outcome="fill"} 42

# HELP algo_pnl_total Total realized PnL in USD
# TYPE algo_pnl_total gauge
algo_pnl_total 1234.56
```

Exported metrics:
- `algo_trades_total` — Counter by strategy and outcome
- `algo_pnl_total` — Gauge of total P&L
- `algo_win_rate` — Gauge (0-1)
- `algo_active_positions` — Gauge count
- `algo_api_request_duration_seconds` — Histogram

**Example:**

```bash
curl -X GET http://localhost:3000/api/metrics
```

---

## Engine Endpoints

All engine endpoints require authentication (Bearer JWT or API Key).

### GET /api/status

Engine status, running strategies, and trade counts.

**Response** (200 OK):

```json
{
  "running": true,
  "strategies": ["grid-trading", "dca-bot"],
  "tradeCount": 123,
  "config": {
    "exchange": "kraken",
    "pairs": ["BTC/USD", "ETH/USD"]
  },
  "uptime": 7200000
}
```

**Example:**

```bash
curl -H "X-API-Key: your_api_key" \
  http://localhost:3000/api/status
```

---

### GET /api/trades

Retrieve the last 100 executed trades.

**Response** (200 OK):

```json
{
  "trades": [
    {
      "orderId": "order-001",
      "marketId": "BTC/USD",
      "side": "buy",
      "fillPrice": "42500.50",
      "fillSize": "0.1",
      "fees": "0.00425",
      "timestamp": 1700000000000,
      "strategy": "grid-trading"
    }
  ],
  "count": 42
}
```

| Field | Type | Description |
|-------|------|-------------|
| orderId | string | Unique order identifier |
| marketId | string | Trading pair (e.g., BTC/USD) |
| side | string | "buy" or "sell" |
| fillPrice | string | Execution price |
| fillSize | string | Quantity filled |
| fees | string | Fees paid in USD |
| timestamp | number | Unix milliseconds |
| strategy | string | Strategy name |

**Example:**

```bash
curl -H "X-API-Key: your_api_key" \
  http://localhost:3000/api/trades
```

---

### GET /api/pnl

Aggregated profit & loss summary by strategy.

**Response** (200 OK):

```json
{
  "totalFees": "0.012345",
  "tradeCount": 234,
  "tradesByStrategy": {
    "grid-trading": 120,
    "dca-bot": 114
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| totalFees | string | Total fees paid (decimal string) |
| tradeCount | number | Total executed trades |
| tradesByStrategy | object | Trade counts by strategy name |

**Example:**

```bash
curl -H "X-API-Key: your_api_key" \
  http://localhost:3000/api/pnl
```

---

## Strategy Endpoints

Control strategy execution via these endpoints.

### POST /api/strategy/start

Start a named strategy.

**Request Body:**

```json
{
  "name": "grid-trading"
}
```

Valid strategy names:
- `cross-market-arb`
- `market-maker`
- `grid-trading`
- `dca-bot`
- `funding-rate-arb`

**Response** (200 OK):

```json
{
  "ok": true,
  "strategy": "grid-trading",
  "action": "started"
}
```

**Error Response** (400 Bad Request):

```json
{
  "error": "Invalid strategy name",
  "valid": ["cross-market-arb", "market-maker", "grid-trading", "dca-bot", "funding-rate-arb"]
}
```

**Example:**

```bash
curl -X POST \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"name":"grid-trading"}' \
  http://localhost:3000/api/strategy/start
```

---

### POST /api/strategy/stop

Stop a running strategy.

**Request Body:**

```json
{
  "name": "grid-trading"
}
```

**Response** (200 OK):

```json
{
  "ok": true,
  "strategy": "grid-trading",
  "action": "stopped"
}
```

**Example:**

```bash
curl -X POST \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"name":"grid-trading"}' \
  http://localhost:3000/api/strategy/stop
```

---

## Billing Endpoints

### POST /api/checkout

Create a Polar.sh hosted checkout session for tier upgrades.

**Request Body:**

```json
{
  "tier": "pro",
  "userId": "user-abc-123",
  "successUrl": "https://yourapp.com/success",
  "cancelUrl": "https://yourapp.com/cancel"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| tier | string | Yes | "pro" or "enterprise" |
| userId | string | Yes | User ID to associate subscription |
| successUrl | string | Yes | Redirect after successful payment |
| cancelUrl | string | No | Redirect if user cancels |

**Response** (200 OK):

```json
{
  "checkoutUrl": "https://checkout.polar.sh/xyz123",
  "checkoutId": "checkout-abc-123"
}
```

**Error Response** (400 Bad Request):

```json
{
  "error": "Missing required fields: tier, userId, successUrl"
}
```

**Example:**

```bash
curl -X POST \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "tier": "pro",
    "userId": "user-123",
    "successUrl": "https://example.com/success"
  }' \
  http://localhost:3000/api/checkout
```

---

### POST /api/webhooks/polar

Receive Polar subscription events. HMAC-signed webhook endpoint.

**Webhook Headers** (required):

```
webhook-id: evt_xyz123
webhook-timestamp: 1700000000
webhook-signature: v1,<hmac_signature>
```

**Request Body** (Polar webhook payload):

```json
{
  "type": "subscription.created",
  "data": {
    "id": "sub-123",
    "customer_id": "cus-456",
    "product_id": "prod-pro",
    "status": "active"
  }
}
```

Handled events:
- `subscription.created` — Activate subscription and set tier
- `subscription.updated` — Update user tier
- `subscription.canceled` — Downgrade to free tier

**Response** (200 OK):

```json
{
  "acknowledged": true
}
```

**Verification:** HMAC-SHA256 signature over raw request body using `POLAR_WEBHOOK_SECRET`.

---

## Error Handling

### Standard Error Response

All errors return JSON with this structure:

```json
{
  "error": "Error Type",
  "message": "Human-readable message"
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Request succeeded |
| 400 | Invalid request body or parameters |
| 401 | Missing or invalid authentication |
| 404 | Endpoint or resource not found |
| 405 | HTTP method not allowed |
| 429 | Rate limit exceeded |
| 500 | Server error |
| 502 | Billing provider error |
| 503 | Service unavailable (e.g., Polar not configured) |

### Error Examples

**401 Unauthorized:**

```json
{
  "error": "Unauthorized",
  "message": "Invalid or expired JWT token"
}
```

**429 Too Many Requests:**

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Retry after 5s.",
  "retryAfter": 5
}
```

---

## SDK Usage

Use the TypeScript SDK for type-safe API calls:

```typescript
import { CashClawClient } from '@algo-trade/sdk';

const client = new CashClawClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'your_api_key'
});

try {
  const health = await client.getHealth();
  console.log('Status:', health.status);
} catch (error) {
  console.error('API error:', error.message);
}
```

See [SDK Quickstart](./sdk-quickstart.md) for detailed examples.

---

## OpenAPI Specification

Full OpenAPI 3.0 specification available at:

```
GET http://localhost:3000/api-docs/openapi.json
```

Use with:
- **Swagger UI:** http://localhost:3000/api-docs
- **Code generators:** openapi-generator, swagger-codegen
- **Client SDKs:** SwaggerHub, OpenAPI client libraries

---

## Rate Limiting Strategy

The rate limiter uses a **sliding 60-second window** for each user/tier:

1. Each request is timestamped
2. Timestamps older than 60 seconds are pruned
3. If remaining timestamps ≥ tier limit, request is rejected
4. Otherwise, current timestamp is recorded and request proceeds

**Retry Strategy:**

When rate-limited, use the `Retry-After` header:

```bash
# Request denied
HTTP/1.1 429 Too Many Requests
Retry-After: 5

# Wait 5 seconds, then retry
sleep 5
curl ... # retry
```

Implement exponential backoff for production:

```typescript
async function retryWithBackoff(fn, maxAttempts = 3) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e.statusCode === 429) {
        const delay = Math.pow(2, i) * 1000;
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
}
```

---

## Webhook Security

All Polar webhooks are HMAC-SHA256 signed. Verify before processing:

1. Extract `webhook-signature` header
2. Compute HMAC: `HMAC-SHA256(raw_body, POLAR_WEBHOOK_SECRET)`
3. Compare signatures using constant-time comparison
4. Process only if signatures match

Example verification (from source):

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyWebhook(rawBody, signature, secret) {
  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  return timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

---

## Subscription Tiers

Three tiers available via Polar:

| Tier | Price | Requests/min | Features |
|------|-------|--------------|----------|
| Free | $0 | 10 | Read-only endpoints |
| Pro | $49/mo | 100 | Start/stop strategies |
| Enterprise | Custom | 1000 | Custom features, SLA |

Tiers are set via Polar product IDs:
- Free: no product (default)
- Pro: `prod-pro`
- Enterprise: `prod-enterprise`

Product mappings are maintained in `src/billing/polar-product-map.ts`.

---

## Monitoring

Monitor API health via:

1. **Health endpoint:** `GET /api/health` (every 30s)
2. **Prometheus metrics:** `GET /api/metrics`
3. **Webhook delivery:** Polar webhook logs in platform
4. **Response codes:** Track 5xx errors

Set up alerts for:
- Health status `degraded` or `down`
- 429 rate limit errors (capacity planning)
- 5xx errors (investigation needed)
- Webhook failures (subscription sync issues)

---

## Changelog

### v1.0.0 (Current)

- Initial API release
- JWT and API Key authentication
- Rate limiting by tier
- Strategy start/stop
- Trade history and P&L endpoints
- Polar billing integration
- Prometheus metrics export
