# Code Review: Polar.sh -> NOWPayments Migration

**Date:** 2026-03-27
**Commit:** d5cc481 (merge) / 5301d64 (implementation)
**Reviewer:** code-reviewer agent

---

## Scope

- Files changed: 17 (242 insertions, 508 deletions — net reduction)
- Focus: Security (HMAC-SHA512), idempotency, type safety, completeness
- Build: PASS (tsc --noEmit clean)
- Tests: 269/269 PASS (6.45s)

## Overall Assessment

Clean migration from Polar.sh SDK to NOWPayments REST/IPN. Good provider-agnostic renaming (`polarPaymentId` -> `providerPaymentId`). HMAC-SHA512 signature verification is correctly implemented per NOWPayments docs (sorted JSON keys). Solid reduction in code surface area (-266 lines net).

---

## Critical Issues

### C1: Webhook route NOT registered in application

`nowpaymentsWebhookRoutes()` is exported from `src/api/routes/webhooks/nowpayments-webhook.ts` but **never imported or registered** in any Fastify app setup. Grep for `nowpaymentsWebhookRoutes` across `src/` returns only the definition site.

**Note:** The old `polarWebhookRoutes` was also never registered. This is a pre-existing gap, but it means IPN webhooks will 404 in production.

**Fix:** Register in the Fastify app entry point:
```typescript
import { nowpaymentsWebhookRoutes } from './api/routes/webhooks/nowpayments-webhook';
fastify.register(nowpaymentsWebhookRoutes, { prefix: '/webhooks/nowpayments' });
```

**Impact:** Payment notifications will never reach the handler. Subscriptions cannot activate via crypto payments.

---

## High Priority

### H1: `payment_id` is a number in NOWPayments API, typed as string

`NowPaymentsIpnPayload.payment_id` is typed as `string` but NOWPayments API returns it as a `number`. The `JSON.stringify` sort-and-compare for HMAC will work regardless (JSON preserves type), but downstream code passing it to `recordPaymentSuccess(providerPaymentId: string, ...)` could fail if the IPN sends `12345` instead of `"12345"`.

**Fix:** Either type it as `number | string` with explicit `String(ipn.payment_id)` coercion, or type as `number` and coerce at the boundary.

### H2: Stale Polar references in `usage-metering.ts`

Method `syncWithPolar()` still named with "Polar" (line 226). JSDoc says "Sync usage data with Polar.sh" (line 224). Comments reference "Polar" at lines 236, 260, 323. The internal service reference was updated (`nowPaymentsService`) but the public API and comments were not.

**Fix:** Rename to `syncUsage()` and update all Polar comments/log messages.

### H3: `handleIpnIntermediate` imported but unused at webhook level

`handleIpnIntermediate` is exported from `checkout-handler.ts` and re-exported from `handlers/index.ts`, but `nowpayments-webhook.ts` does NOT import or call it in the `'ignore'` case branch (line 78-80). The function is dead code.

**Fix:** Either import and call it in the `'ignore'` branch for structured logging, or remove the export.

### H4: Missing `handleCheckoutCreated` import causes runtime gap

The old `polar-webhook.ts` imported `handleCheckoutCreated` which is now gone. The `handlers/index.ts` correctly exports `handleIpnIntermediate` instead. No breakage since the old webhook file was deleted — but the replacement function is not wired in (see H3).

---

## Medium Priority

### M1: No idempotency on `handleIpnPaymentSuccess`/`handleIpnPaymentFailed`

`handleIpnFinished` correctly checks idempotency:
```typescript
const existing = await subscriptionService.getSubscriptionByProviderId(ipn.payment_id);
if (existing && existing.status === 'active') return;
```

But `handleIpnPaymentSuccess` and `handleIpnPaymentFailed` in `payment-handler.ts` do NOT check for duplicate `payment_id`. NOWPayments can send duplicate IPNs. Each call to `recordPaymentSuccess()` creates a new Payment record with `generateId()`.

**Fix:** Add idempotency check in payment handlers:
```typescript
const existing = await paymentService.getPaymentByProviderId(ipn.payment_id);
if (existing) return;
```

### M2: `customerEmail` field populated with non-email data

In `handleIpnFinished`, when `order_id` is missing:
```typescript
const customerEmail = customerRef || `payment_${ipn.payment_id}`;
```
This creates subscriptions with `customerEmail: "payment_12345"` which is not a valid email. Downstream code (notifications, dunning) may break on invalid email format.

**Fix:** Use a distinct field or validate email format. Consider making `customerEmail` optional in the Subscription interface for crypto payments where email is not available.

### M3: `handleIpnFinished` passes `licenseService` in signature but never uses it directly

Function signature accepts `licenseService: LicenseService` but delegates license creation to `subscriptionService.activateSubscription()` internally. The parameter is unused — the license service comes from the subscription service's own dependency.

**Fix:** Remove `licenseService` from the function signature and the call site in `nowpayments-webhook.ts`.

### M4: Hardcoded 30-day subscription period

```typescript
const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
```
No configuration or per-tier period logic. Enterprise tier might need different billing cycles.

**Fix:** Move period duration to `NowPaymentsTierConfig` or make it configurable.

### M5: `JSON.stringify(parsed, sortedKeys)` — replacer array behavior

Line 107 of `nowpayments-service.ts`:
```typescript
const sorted = JSON.stringify(parsed, sortedKeys);
```
`JSON.stringify` with an array replacer ONLY includes keys in the array. If the IPN payload contains nested objects, their nested keys are ALSO filtered by this array. Per NOWPayments docs, the IPN payload is flat, so this works — but will silently break if NOWPayments adds nested fields in the future.

**Impact:** Low risk now, worth documenting the assumption.

---

## Low Priority

### L1: Dashboard portal link points to generic NOWPayments dashboard

```tsx
href="https://nowpayments.io/dashboard"
```
This is the merchant dashboard, not a customer-facing subscription portal. Customers clicking this won't see their subscriptions — they'll see the NOWPayments login page.

**Fix:** Either remove the link, build a custom portal page, or link to a status/history page if available.

### L2: `@polar-sh/sdk` removed from dependencies but no NOWPayments SDK added

No SDK needed since the integration uses raw `fetch` + HMAC verification. This is actually fine and reduces dependency surface. Just noting for completeness.

### L3: `NOWPAYMENTS_INVOICE_PRO` and `NOWPAYMENTS_INVOICE_ENTERPRISE` in `.env.example` but no validation

These are read via `process.env` in `NOWPAYMENTS_TIERS` config. No startup validation warns if these are empty (unlike `NOWPAYMENTS_API_KEY` which logs a warning). Checkout URL generation will silently return `null`.

---

## Edge Cases Found by Scout

1. **Duplicate IPN delivery** — NOWPayments can retry IPNs. Subscription handler has idempotency; payment handler does NOT (see M1).
2. **`partially_paid` status** — mapped to `'ignore'` which is correct, but no record is kept. If a customer partially pays, there's no way to follow up.
3. **Race condition** — Two near-simultaneous IPNs for same `payment_id` could both pass the idempotency check before either writes. In-memory Map in SubscriptionService has no locking. Low risk with single-process deployment.
4. **Content-type parser override** — `nowpayments-webhook.ts` line 33-39 adds a custom JSON content-type parser. If registered on the main Fastify instance (not a scoped prefix), this will override JSON parsing for ALL routes, breaking request body parsing.
5. **`payment_id` as string in idempotency check** — If NOWPayments sends `payment_id` as number, the `getSubscriptionByProviderId(ipn.payment_id)` comparison against stored string will fail silently (no match), bypassing idempotency.

---

## Positive Observations

- Provider-agnostic renaming (`providerPaymentId`) future-proofs for payment provider switches
- Net code reduction (-266 lines) while maintaining functionality
- Clean HMAC-SHA512 implementation using Web Crypto API (no external deps)
- Proper raw body handling for signature verification (custom content-type parser)
- Tests comprehensively updated — 269 tests all passing
- No secrets in code; all keys via env vars
- `getStatusAction()` pattern cleanly maps IPN statuses to business actions

---

## Recommended Actions (Priority Order)

1. **[CRITICAL]** Register `nowpaymentsWebhookRoutes` in Fastify app entry point (C1)
2. **[HIGH]** Add idempotency check to payment handlers (M1)
3. **[HIGH]** Coerce `payment_id` to string at IPN parse boundary (H1)
4. **[HIGH]** Rename `syncWithPolar` and clean remaining Polar references (H2)
5. **[MEDIUM]** Handle `customerEmail` for crypto payments without email (M2)
6. **[MEDIUM]** Remove unused `licenseService` param from `handleIpnFinished` (M3)
7. **[MEDIUM]** Verify content-type parser is scoped to webhook prefix (edge case 4)
8. **[LOW]** Fix dashboard portal link (L1)

---

## Metrics

- TypeScript: 0 errors (tsc --noEmit)
- Tests: 269/269 passed
- Linting: Not run (no lint script found in scope)
- Stale Polar refs remaining: 5 (in usage-metering.ts)

---

## Unresolved Questions

1. Is the webhook route supposed to be registered elsewhere (separate server process, API gateway)? The old polar route was also unregistered — might be by design if there's a separate webhook receiver service.
2. What is the expected `payment_id` type from NOWPayments IPN — string or number? Verify against actual IPN payloads.
3. Should `partially_paid` status trigger a notification to the customer to complete payment?
