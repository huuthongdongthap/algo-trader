// Polar.sh webhook handler — Standard Webhooks HMAC-SHA256 verification
// Processes subscription lifecycle and checkout events

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Tier } from '../users/subscription-tier.js';

// --- Event types ---

export type PolarEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'checkout.completed';

export interface PolarWebhookEvent<T = unknown> {
  type: PolarEventType;
  data: T;
  created_at: string; // ISO 8601
}

export interface PolarSubscriptionEventData {
  id: string;
  status: string;
  customer_id: string;
  product_id: string;
  price_id: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  /** Benefit grants attached to the subscription */
  granted_benefits?: Array<{ benefit_id: string; benefit_description: string }>;
}

export interface PolarCheckoutEventData {
  id: string;
  status: string;
  customer_email: string | null;
  product_price_id: string;
  subscription_id: string | null;
}

// --- Benefit → Tier mapping ---

/**
 * Map a Polar benefit ID to an internal subscription tier.
 * Benefit IDs come from environment variables so they are configurable per environment.
 * Falls back to 'free' when no match is found.
 */
export function mapPolarTierToBenefit(benefitId: string): Tier {
  const proId = process.env['POLAR_BENEFIT_PRO'] ?? '';
  const enterpriseId = process.env['POLAR_BENEFIT_ENTERPRISE'] ?? '';

  if (benefitId === enterpriseId) return 'enterprise';
  if (benefitId === proId) return 'pro';
  return 'free';
}

// --- Signature verification ---

/**
 * Verify a Polar webhook signature using Standard Webhooks HMAC-SHA256.
 * Standard Webhooks format: "v1,<base64-signature>"
 * Signed payload: "<webhook-id>.<webhook-timestamp>.<raw-body>"
 *
 * @see https://docs.polar.sh/developers/webhooks
 */
export function verifyPolarSignature(
  payload: string,
  signature: string,
  secret: string,
  webhookId: string,
  webhookTimestamp: string,
): boolean {
  // Reject timestamps older than 5 minutes to prevent replay attacks
  const sentAt = Number(webhookTimestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - sentAt) > 300) return false;

  // Standard Webhooks signed content
  const signedContent = `${webhookId}.${webhookTimestamp}.${payload}`;

  // Secret may be prefixed with "whsec_" — strip it
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const secretBytes = Buffer.from(rawSecret, 'base64');

  const expectedHmac = createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // Signature header may contain multiple comma-separated "v1,<sig>" entries
  const signatures = signature.split(' ').flatMap((s) => s.split(','));
  const v1Sigs = signatures.filter((_, i, arr) => arr[i - 1] === 'v1');

  return v1Sigs.some((sig) => {
    try {
      return timingSafeEqual(Buffer.from(sig, 'base64'), Buffer.from(expectedHmac, 'base64'));
    } catch {
      return false;
    }
  });
}

// --- Event handler ---

export interface WebhookHandlerResult {
  acknowledged: boolean;
  event: PolarWebhookEvent;
  /** Resolved tier when event carries subscription data */
  resolvedTier?: Tier;
}

/**
 * Verify and parse an incoming Polar webhook request.
 *
 * @param payload   - Raw request body string (before JSON.parse)
 * @param signature - Value of the "webhook-signature" header
 * @param secret    - Webhook secret from Polar dashboard (POLAR_WEBHOOK_SECRET)
 * @param webhookId        - Value of the "webhook-id" header
 * @param webhookTimestamp - Value of the "webhook-timestamp" header
 */
export function handlePolarWebhook(
  payload: string,
  signature: string,
  secret: string,
  webhookId: string,
  webhookTimestamp: string,
): WebhookHandlerResult {
  const valid = verifyPolarSignature(payload, signature, secret, webhookId, webhookTimestamp);
  if (!valid) {
    throw new Error('Polar webhook signature verification failed');
  }

  const event = JSON.parse(payload) as PolarWebhookEvent;

  let resolvedTier: Tier | undefined;

  switch (event.type) {
    case 'subscription.created':
    case 'subscription.updated':
    case 'subscription.canceled': {
      const data = event.data as PolarSubscriptionEventData;
      const firstBenefit = data.granted_benefits?.[0]?.benefit_id;
      if (firstBenefit) {
        resolvedTier = mapPolarTierToBenefit(firstBenefit);
      }
      break;
    }
    case 'checkout.completed':
      // No benefit mapping at checkout stage — subscription events carry benefit grants
      break;
    default:
      // Unknown event types are acknowledged but not processed
      break;
  }

  return { acknowledged: true, event, resolvedTier };
}
