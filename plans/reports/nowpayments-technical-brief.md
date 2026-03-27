# NOWPayments API Integration Technical Brief

**Date:** 2026-03-27
**Source:** Live production integration from sophia-ai-factory (Vercel Next.js)
**Status:** Verified integration pattern for USDT TRC20 payments

---

## Executive Summary

NOWPayments is a crypto-native payment provider replacing traditional processors like Polar.sh. Key advantages:
- **USDT TRC20** direct settlement (lower fees, faster confirmation)
- **No traditional KYC** required for merchants
- **Invoice-based** model (pre-created in dashboard, referenced via IDs)
- **HMAC-SHA512 IPN signatures** for webhook verification
- **Order tracking** via order_id parameter

---

## 1. Authentication & Headers

### API Key Authentication
- **Header format:** `Authorization: Bearer {API_KEY}`
- **Environment variable:** `NOWPAYMENTS_API_KEY` (store in `.env.local`)
- **Usage:** All REST API calls (GET /status, POST /create, etc.)

### IPN/Webhook Authentication
- **Header field:** `x-nowpayments-sig` (signature value)
- **Secret source:** `NOWPAYMENTS_IPN_SECRET` (environment variable)
- **Algorithm:** HMAC-SHA512 over sorted JSON keys
- **Setup in dashboard:** Create IPN endpoint → copy auto-generated secret

---

## 2. Key Endpoints

### Create Payment Invoice (Pre-created Model)
**NOWPayments uses pre-created invoices** in the dashboard, not dynamic creation.

**Flow:**
1. Create invoice once in NOWPayments dashboard (get `invoiceId`)
2. Store invoiceId in tier config
3. Generate checkout URL with invoiceId + order_id

```
GET https://nowpayments.io/payment?iid={invoiceId}&order_id={orderId}
```

**Parameters:**
- `iid` (invoice ID): Pre-created invoice ID from dashboard
- `order_id` (string): Custom tracking ID (e.g., `sophia_{orgId}_{timestamp}`)

**Response:** Redirect to NOWPayments hosted payment form

### Check Payment Status
```
GET https://api.nowpayments.io/v1/payment/{payment_id}
Headers: Authorization: Bearer {API_KEY}
```

**Response:**
```json
{
  "payment_id": "3456789123",
  "payment_status": "finished",
  "price_amount": 199,
  "price_currency": "USD",
  "pay_amount": 195.50,
  "pay_currency": "USDT",
  "order_id": "sophia_org123_1711699200",
  "invoice_id": "6075842741"
}
```

**Status Values:**
- `waiting` → Payment awaiting initiation
- `confirming` → Blockchain confirming
- `confirmed` → On-chain confirmed
- `sending` → Settlement processing
- `finished` → ✅ Payment complete (activate subscription)
- `partially_paid` → ⏳ Hold (wait for full amount)
- `failed` → ❌ Payment rejected
- `refunded` → ❌ Refunded (deactivate subscription)
- `expired` → ❌ Invoice expired

---

## 3. Webhook/IPN Verification

### IPN Payload Signature Verification

**Algorithm: HMAC-SHA512 over sorted JSON**

```typescript
async function verifyIpnSignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  // 1. Parse JSON
  const parsed = JSON.parse(rawBody) as Record<string, unknown>

  // 2. Sort keys alphabetically
  const sorted = JSON.stringify(parsed, Object.keys(parsed).sort())

  // 3. HMAC-SHA512
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(sorted))

  // 4. Convert to hex string
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  // 5. Compare
  return computed === signature
}
```

### Critical Steps
1. **Use raw request body** (before JSON parsing) for signature computation
2. **Sort all JSON keys** alphabetically
3. **Use crypto.subtle API** (no external dependencies needed)
4. **Store IPN secret securely** in environment only

---

## 4. USDT TRC20 Payment Flow

### Complete Flow Diagram

```
User clicks "Upgrade" tier
    ↓
Generate invoice URL: https://nowpayments.io/payment?iid=6075842741&order_id=sophia_org123_1234567890
    ↓
User redirected to NOWPayments payment form
    ↓
User selects USDT TRC20 network
    ↓
User scans QR or copies wallet address (e.g., TQr6E84wQXp...)
    ↓
User sends USDT TRC20 to address (tron blockchain)
    ↓
NOWPayments monitors TRON network for confirmations
    ↓
After 1+ confirmation: payment_status → "confirmed" → "finished"
    ↓
NOWPayments POST to webhook: https://yourapp.com/api/webhooks/nowpayments
    ↓
Webhook receives IPN with x-nowpayments-sig header
    ↓
Verify signature using NOWPAYMENTS_IPN_SECRET
    ↓
If valid: Parse payment_status
    ↓
If "finished": Activate subscription for orgId
    ↓
Return 200 OK to NOWPayments (idempotency: avoid duplicate processing)
```

### Why USDT TRC20?
- **Settlement fee:** ~1 USDT (vs 2-3% on credit cards)
- **Speed:** 3-6 seconds confirmation on TRON
- **No chargebacks:** Blockchain finality
- **No KYC** (up to daily/monthly limits depending on business tier)

---

## 5. TypeScript Types & Interfaces

### Core IPN Payload Type

```typescript
export interface NowPaymentsIpnPayload {
  payment_id: string
  payment_status: 'waiting' | 'confirming' | 'confirmed' | 'sending' | 'partially_paid' | 'finished' | 'failed' | 'refunded' | 'expired'
  pay_address?: string                    // TRON wallet that received payment
  price_amount: number                    // Invoice amount in USD (199)
  price_currency: string                  // "USD"
  pay_amount?: number                     // Crypto amount user sent
  pay_currency?: string                   // "USDT", "ETH", etc.
  order_id?: string                       // Custom ID: sophia_{orgId}_{timestamp}
  order_description?: string
  invoice_id?: string                     // Links to tier: 6075842741 → BASIC
  actually_paid?: number
  outcome_amount?: number
  outcome_currency?: string
}
```

### Tier Configuration Type

```typescript
export interface NowPaymentsTierConfig {
  tier: 'BASIC' | 'PREMIUM' | 'ENTERPRISE' | 'MASTER'
  invoiceId: string                       // Pre-created in dashboard
  price: number                           // USD
  currency: string                        // "USD"
  name: string                            // Display name
}

// Configuration mapping
export const NOWPAYMENTS_TIERS: Record<string, NowPaymentsTierConfig> = {
  BASIC: {
    tier: 'BASIC',
    invoiceId: '6075842741',
    price: 199,
    currency: 'USD',
    name: 'Starter',
  },
  PREMIUM: {
    tier: 'PREMIUM',
    invoiceId: '5213459112',
    price: 399,
    currency: 'USD',
    name: 'Growth',
  },
  // ... more tiers
}
```

### Webhook Handler Response

```typescript
interface WebhookHandlerResponse {
  success: boolean
  message: string  // "Processed finished" or error detail
}
```

---

## 6. Minimum Viable Integration Code Pattern

### A. Client Setup (lib/clients/nowpayments-client.ts)

```typescript
// Store tier configs with invoice IDs
export const NOWPAYMENTS_TIERS = { /* ... */ }

// Generate checkout URL
export function createInvoiceUrl(tierId: string, orgId: string): string {
  const tierConfig = NOWPAYMENTS_TIERS[tierId]
  const orderId = `sophia_${orgId}_${Date.now()}`
  return `https://nowpayments.io/payment?iid=${tierConfig.invoiceId}&order_id=${orderId}`
}

// Verify IPN signature
export async function verifyIpnSignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const parsed = JSON.parse(rawBody)
  const sorted = JSON.stringify(parsed, Object.keys(parsed).sort())
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(sorted))
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  return computed === signature
}

// Lookup tier by invoice ID
export function getTierByInvoiceId(invoiceId: string): NowPaymentsTierConfig | null {
  return Object.values(NOWPAYMENTS_TIERS).find(t => t.invoiceId === invoiceId) ?? null
}
```

### B. IPN Handlers (lib/billing/nowpayments-ipn-handlers.ts)

```typescript
// Parse orgId from order_id
function parseOrgIdFromOrderId(orderId: string): string | null {
  const parts = orderId.split('_')
  return parts.length >= 3 && parts[0] === 'sophia' ? parts[1] : null
}

// Idempotency check
async function isPaymentProcessed(paymentId: string): Promise<boolean> {
  const { data } = await supabase
    .from('payment_events')
    .select('processed')
    .eq('polar_event_id', `nowpayments_${paymentId}`)
    .single()
  return data?.processed === true
}

// Handle finished payment
async function handleFinished(ipn: NowPaymentsIpnPayload): Promise<void> {
  const tierConfig = getTierByInvoiceId(ipn.invoice_id!)
  const orgId = parseOrgIdFromOrderId(ipn.order_id!)
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  await supabase
    .from('user_profiles')
    .update({
      subscription_tier: tierConfig.tier,
      subscription_status: 'active',
      subscription_expires_at: periodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', orgId)

  logger.info('Payment activated', { orgId, tier: tierConfig.tier })
}

// Main dispatcher
export async function processNowPaymentsIpn(ipn: NowPaymentsIpnPayload): Promise<{ success: boolean; message: string }> {
  if (await isPaymentProcessed(ipn.payment_id)) {
    return { success: true, message: 'Already processed' }
  }

  try {
    switch (ipn.payment_status) {
      case 'finished':
        await handleFinished(ipn)
        break
      case 'refunded':
        // Deactivate subscription
        break
      case 'failed':
        // Notify user
        break
      // ... other statuses
    }
    return { success: true, message: `Processed ${ipn.payment_status}` }
  } catch (error) {
    logger.error('IPN processing failed', error)
    return { success: false, message: error.message }
  }
}
```

### C. Webhook Route (app/api/webhooks/nowpayments/route.ts)

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIpnSignature } from '@/lib/clients/nowpayments-client'
import { processNowPaymentsIpn } from '@/lib/billing/nowpayments-ipn-handlers'

const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET

export async function POST(request: NextRequest) {
  if (!IPN_SECRET) {
    return NextResponse.json({ error: 'Config error' }, { status: 500 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-nowpayments-sig')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  // Verify signature before parsing
  const isValid = await verifyIpnSignature(rawBody, signature, IPN_SECRET)
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Parse and process
  const ipn = JSON.parse(rawBody)
  const result = await processNowPaymentsIpn(ipn)

  return NextResponse.json(result, { status: result.success ? 200 : 500 })
}
```

### D. Checkout Flow (app/api/checkout/route.ts)

```typescript
import { createInvoiceUrl } from '@/lib/clients/nowpayments-client'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tier = searchParams.get('tier')  // e.g., "PREMIUM"
  const orgId = searchParams.get('org')

  const checkoutUrl = createInvoiceUrl(tier, orgId)
  return Response.redirect(checkoutUrl, 302)
}
```

---

## 7. Environment Variables

```bash
# .env.local
NOWPAYMENTS_API_KEY=your-api-key-from-dashboard
NOWPAYMENTS_IPN_SECRET=your-ipn-secret-from-dashboard
```

**Security:**
- Never commit `.env.local`
- Add to `.gitignore`
- Store in production via Vercel Environment Variables
- Rotate IPN secret annually

---

## 8. Critical Implementation Notes

### Idempotency (MUST Implement)
- Store `payment_id` + `payment_status` in `payment_events` table
- Check before processing: `WHERE polar_event_id = 'nowpayments_{payment_id}'`
- Reason: NOWPayments may retry webhook delivery on timeout
- **Risk:** Without idempotency → duplicate subscription credits

### Signature Verification (SECURITY)
- Always verify `x-nowpayments-sig` before trusting IPN data
- Sort JSON keys alphabetically (order matters)
- Use `crypto.subtle` API (built-in, no external deps)
- Return 400 for invalid signatures (NOWPayments will retry)

### Order ID Format (TRACKING)
- Format: `sophia_{orgId}_{timestamp}`
- Enables reverse lookup from IPN to activate correct org
- Store in IPN payload for audit trail

### Status Handling
- `finished` → Activate subscription
- `refunded` → Cancel subscription
- `failed` → Log + notify (don't block)
- `partially_paid` → Hold (wait for full payment)
- `expired` → No action (invoice timed out)

### Testing
- **Test invoice ID:** Create test invoice in NOWPayments sandbox
- **Webhook delivery:** Can't trigger manually; use IPN simulation in dashboard
- **Signature verification:** Test with hardcoded example IPN payload

---

## 9. NPM Packages

**No official SDK required.** Implementation uses:
- `crypto` (built-in Node.js API)
- `fetch` (built-in browser API)
- `next` (for request/response handling)

**Optional for API calls:**
```bash
npm install axios  # For HTTP client (alternative to fetch)
```

---

## 10. Known Limitations & Workarounds

| Issue | Workaround |
|-------|-----------|
| No dynamic invoice creation | Pre-create invoices in dashboard, store IDs in config |
| No quantity-based pricing | Create separate invoices per tier (one-time setup) |
| Limited webhook retry logic | Implement DB-based idempotency immediately |
| Invoice updates (price change) | Create new invoice, update tier config, notify users |
| Sandbox testing | Contact support for test credentials, use simulation in dashboard |

---

## 11. Deployment Checklist

- [ ] Add `NOWPAYMENTS_API_KEY` to Vercel environment variables
- [ ] Add `NOWPAYMENTS_IPN_SECRET` to Vercel environment variables
- [ ] Deploy webhook route: `POST /api/webhooks/nowpayments`
- [ ] Configure webhook URL in NOWPayments dashboard
- [ ] Create database migration for `payment_events` table
- [ ] Test signature verification with example payload
- [ ] Test idempotency (send same IPN twice, should only process once)
- [ ] Monitor logs for first week of production

---

## 12. Reference URLs

- **API Docs:** https://documenter.getpostman.com/view/7907941/2s93JusNJt
- **Dashboard:** https://nowpayments.io/dashboard
- **Support Email:** support@nowpayments.io

---

## Key Takeaways

1. **No API-driven invoice creation** — Use pre-created invoices from dashboard
2. **HMAC-SHA512 signature verification** — Non-negotiable security step
3. **Order ID parsing** — Enables org-level tracking from IPN
4. **Idempotency essential** — Store payment_id to prevent duplicate credits
5. **USDT TRC20 default** — Settlement speed + low fees
6. **Built-in Web Crypto API** — No external crypto library needed
7. **Environment-based secrets** — Never hardcode API keys or IPN secret

---

**Document Generated:** 2026-03-27
**Integration Status:** Verified in production (sophia-ai-factory)
**Last Updated:** 2026-03-27
