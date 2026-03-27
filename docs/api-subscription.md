# Subscription API Documentation

**Version:** 1.0.0
**Base URL:** `/api/subscription`

---

## Overview

Subscription management API for NOWPayments integration with license tier control.

**Features:**
- License status checking
- NOWPayments invoice creation
- Manual license activation/downgrade (admin only)
- Rate limiting per API key
- Full audit logging

---

## Authentication

All endpoints require API key authentication via header:

```http
X-API-Key: your-api-key-here
```

**Rate Limits:**
- `/status`: 100 requests/hour
- `/checkout`: 50 requests/hour
- `/activate`: 10 requests/hour (admin only)
- `/downgrade`: 5 requests/hour (admin only)

---

## Endpoints

### GET /api/subscription/status

Get current license status and features.

**Request:**
```http
GET /api/subscription/status
X-API-Key: your-api-key
```

**Response (200 OK):**
```json
{
  "tier": "pro",
  "valid": true,
  "expiresAt": "2027-12-31T23:59:59.999Z",
  "features": [
    "basic_strategies",
    "live_trading",
    "basic_backtest",
    "ml_models",
    "premium_data",
    "advanced_optimization"
  ]
}
```

**Tier Values:**
- `FREE` - Default tier, basic features only
- `PRO` - ML models, premium data, advanced optimization
- `ENTERPRISE` - All features + priority support

---

### POST /api/subscription/checkout

Create NOWPayments invoice for subscription upgrade.

**Request:**
```http
POST /api/subscription/checkout
X-API-Key: your-api-key
Content-Type: application/json

{
  "tier": "pro",
  "customerEmail": "user@example.com"
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tier` | string | Yes | `pro` or `enterprise` |
| `customerEmail` | string | No | Customer email for invoice |

**Response (200 OK):**
```json
{
  "invoiceUrl": "https://nowpayments.io/invoice/abc123",
  "invoiceId": "inv_abc123",
  "amount": "49.00",
  "currency": "USDT_TRC20"
}
```

**Flow:**
1. Call this endpoint
2. Redirect user to `invoiceUrl`
3. User completes USDT payment on NOWPayments
4. NOWPayments sends IPN webhook → license activated automatically

**Errors:**
| Code | Message | Description |
|------|---------|-------------|
| 400 | Missing tier parameter | `tier` field required |
| 400 | Invalid tier | Must be `pro` or `enterprise` |
| 500 | Failed to create checkout session | Polar API error |

---

### POST /api/subscription/activate

Manually activate license (testing/admin only).

**Request:**
```http
POST /api/subscription/activate
X-API-Key: admin-api-key
Content-Type: application/json

{
  "tier": "PRO",
  "licenseKey": "manual"
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tier` | string | Yes | `FREE`, `PRO`, or `ENTERPRISE` |
| `licenseKey` | string | No | License key (default: `manual`) |

**Response (200 OK):**
```json
{
  "success": true,
  "tier": "PRO",
  "message": "Activated PRO license"
}
```

**Errors:**
| Code | Message | Description |
|------|---------|-------------|
| 400 | Missing tier parameter | `tier` field required |
| 400 | Invalid tier | Must be valid LicenseTier value |
| 500 | Failed to activate license | LicenseService error |

**Security:** Admin API key required. Rate limited to 10/hour.

---

### POST /api/subscription/downgrade

Downgrade to FREE tier (testing/admin only).

**Request:**
```http
POST /api/subscription/downgrade
X-API-Key: admin-api-key
```

**Response (200 OK):**
```json
{
  "success": true,
  "tier": "FREE",
  "message": "Downgraded to FREE license"
}
```

**Security:** Admin API key required. Rate limited to 5/hour.

---

## Webhook Integration

### NOWPayments Webhooks

**Endpoint:** `POST /api/v1/billing/webhook`

**Events Handled:**
- `payment_status_track_update` with `is_final_amount_received: true` → Activate PRO/ENTERPRISE
- `invoice.paid` → Activate tier based on invoice amount
- `invoice.partially_paid` → Log payment progress
- `invoice.expired` → Mark invoice as expired
- `invoice.created` → Log only

**Security:**
- HMAC-SHA512 signature verification (x-nowpayments-sig header)
- IPN secret validation
- Idempotency key deduplication

**Webhook Payload:**
```json
{
  "invoice_id": "inv_abc123",
  "order_id": "order_123",
  "payment_status": "finished",
  "pay_amount": "49.00",
  "pay_currency": "USDT_TRC20",
  "is_final_amount_received": true,
  "created_at": "2026-03-27T10:00:00Z"
}
```

---

## Error Handling

### Standard Error Format

```json
{
  "error": "Error type",
  "message": "Human-readable description"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad Request (invalid parameters) |
| 401 | Unauthorized (missing/invalid API key) |
| 403 | Forbidden (insufficient permissions) |
| 429 | Too Many Requests (rate limit exceeded) |
| 500 | Internal Server Error |

---

## Code Examples

### cURL

```bash
# Get subscription status
curl -X GET http://localhost:3000/api/subscription/status \
  -H "X-API-Key: your-api-key"

# Create checkout
curl -X POST http://localhost:3000/api/subscription/checkout \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"tier": "pro"}'

# Activate license (admin)
curl -X POST http://localhost:3000/api/subscription/activate \
  -H "X-API-Key: admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"tier": "PRO"}'
```

### JavaScript/TypeScript

```typescript
// Get subscription status
async function getSubscriptionStatus(apiKey: string) {
  const res = await fetch('/api/subscription/status', {
    headers: { 'X-API-Key': apiKey },
  });
  return res.json();
}

// Create checkout
async function createCheckout(apiKey: string, tier: 'pro' | 'enterprise') {
  const res = await fetch('/api/subscription/checkout', {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tier }),
  });
  return res.json();
}

// Redirect to Polar checkout
const { checkoutUrl } = await createCheckout(apiKey, 'pro');
window.location.href = checkoutUrl;
```

### Python

```python
import requests

def get_subscription_status(api_key: str):
    res = requests.get(
        'http://localhost:3000/api/subscription/status',
        headers={'X-API-Key': api_key}
    )
    return res.json()

def create_checkout(api_key: str, tier: str):
    res = requests.post(
        'http://localhost:3000/api/subscription/checkout',
        headers={'X-API-Key': api_key},
        json={'tier': tier}
    )
    return res.json()
```

---

## Related Documentation

- [Security Audit Report](../plans/reports/security-audit-subscription-260305-2320.md)
- [Phase 5 Production Config](../plans/reports/phase5-production-config-260305-2314.md)
- [RAAS Gate Implementation](../src/lib/raas-gate.ts)
- [NOWPayments Webhook Handler](../src/api/routes/webhooks/nowpayments-webhook.ts)
