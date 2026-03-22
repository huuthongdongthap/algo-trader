// Tests for polar-webhook.ts — signature verification, event handling, tier mapping
import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyPolarSignature,
  handlePolarWebhook,
  mapPolarTierToBenefit,
  type PolarSubscriptionEventData,
  type PolarCheckoutEventData,
} from '../../src/billing/polar-webhook.js';

// --- Helpers ---

function buildSignedPayload(
  payload: string,
  secret: string,
  webhookId: string,
  webhookTimestamp: string,
): string {
  const signedContent = `${webhookId}.${webhookTimestamp}.${payload}`;
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const secretBytes = Buffer.from(rawSecret, 'base64');
  const sig = createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

const SECRET_RAW = Buffer.from('test-secret').toString('base64');
const SECRET = `whsec_${SECRET_RAW}`;

function nowTs() {
  return String(Math.floor(Date.now() / 1000));
}

describe('verifyPolarSignature', () => {
  it('should verify valid signature', () => {
    const payload = '{"type":"subscription.created"}';
    const id = 'msg-001';
    const ts = nowTs();
    const sig = buildSignedPayload(payload, SECRET, id, ts);
    expect(verifyPolarSignature(payload, sig, SECRET, id, ts)).toBe(true);
  });

  it('should reject wrong secret', () => {
    const payload = '{"type":"subscription.created"}';
    const id = 'msg-001';
    const ts = nowTs();
    const sig = buildSignedPayload(payload, SECRET, id, ts);
    const wrongSecret = `whsec_${Buffer.from('wrong').toString('base64')}`;
    expect(verifyPolarSignature(payload, sig, wrongSecret, id, ts)).toBe(false);
  });

  it('should reject tampered payload', () => {
    const payload = '{"type":"subscription.created"}';
    const id = 'msg-001';
    const ts = nowTs();
    const sig = buildSignedPayload(payload, SECRET, id, ts);
    expect(verifyPolarSignature('{"tampered":true}', sig, SECRET, id, ts)).toBe(false);
  });

  it('should reject timestamp older than 5 minutes', () => {
    const payload = '{"type":"subscription.created"}';
    const id = 'msg-old';
    const oldTs = String(Math.floor(Date.now() / 1000) - 400); // 6+ min ago
    const sig = buildSignedPayload(payload, SECRET, id, oldTs);
    expect(verifyPolarSignature(payload, sig, SECRET, id, oldTs)).toBe(false);
  });

  it('should work with secret without whsec_ prefix', () => {
    const bareSecret = SECRET_RAW;
    const payload = '{"type":"checkout.completed"}';
    const id = 'msg-bare';
    const ts = nowTs();
    const sig = buildSignedPayload(payload, bareSecret, id, ts);
    expect(verifyPolarSignature(payload, sig, bareSecret, id, ts)).toBe(true);
  });
});

describe('handlePolarWebhook', () => {
  let subscriptionEvent: object;
  let eventStr: string;
  let webhookId: string;
  let ts: string;
  let sig: string;

  beforeEach(() => {
    const data: PolarSubscriptionEventData = {
      id: 'sub-001',
      status: 'active',
      customer_id: 'cust-1',
      product_id: 'prod-1',
      price_id: 'price-1',
      current_period_end: new Date(Date.now() + 86400000).toISOString(),
      cancel_at_period_end: false,
      granted_benefits: [],
    };
    subscriptionEvent = { type: 'subscription.created', data, created_at: new Date().toISOString() };
    eventStr = JSON.stringify(subscriptionEvent);
    webhookId = 'wh-001';
    ts = nowTs();
    sig = buildSignedPayload(eventStr, SECRET, webhookId, ts);
  });

  it('should acknowledge valid subscription.created event', () => {
    const result = handlePolarWebhook(eventStr, sig, SECRET, webhookId, ts);
    expect(result.acknowledged).toBe(true);
    expect(result.event.type).toBe('subscription.created');
  });

  it('should resolve tier from benefit grant on subscription.created', () => {
    const proId = 'benefit-pro-123';
    process.env['POLAR_BENEFIT_PRO'] = proId;
    const data: PolarSubscriptionEventData = {
      id: 'sub-002',
      status: 'active',
      customer_id: 'cust-2',
      product_id: 'prod-1',
      price_id: 'price-1',
      current_period_end: null,
      cancel_at_period_end: false,
      granted_benefits: [{ benefit_id: proId, benefit_description: 'Pro tier' }],
    };
    const evt = JSON.stringify({ type: 'subscription.created', data, created_at: new Date().toISOString() });
    const s = buildSignedPayload(evt, SECRET, 'wh-p', ts);
    const result = handlePolarWebhook(evt, s, SECRET, 'wh-p', ts);
    expect(result.resolvedTier).toBe('pro');
    delete process.env['POLAR_BENEFIT_PRO'];
  });

  it('should resolve enterprise tier from benefit grant on subscription.updated', () => {
    const entId = 'benefit-ent-456';
    process.env['POLAR_BENEFIT_ENTERPRISE'] = entId;
    const data: PolarSubscriptionEventData = {
      id: 'sub-003',
      status: 'active',
      customer_id: 'cust-3',
      product_id: 'prod-2',
      price_id: 'price-2',
      current_period_end: null,
      cancel_at_period_end: false,
      granted_benefits: [{ benefit_id: entId, benefit_description: 'Enterprise tier' }],
    };
    const evt = JSON.stringify({ type: 'subscription.updated', data, created_at: new Date().toISOString() });
    const s = buildSignedPayload(evt, SECRET, 'wh-e', ts);
    const result = handlePolarWebhook(evt, s, SECRET, 'wh-e', ts);
    expect(result.resolvedTier).toBe('enterprise');
    delete process.env['POLAR_BENEFIT_ENTERPRISE'];
  });

  it('should handle subscription.canceled event', () => {
    const data: PolarSubscriptionEventData = {
      id: 'sub-004',
      status: 'canceled',
      customer_id: 'cust-4',
      product_id: 'prod-1',
      price_id: 'price-1',
      current_period_end: null,
      cancel_at_period_end: true,
      granted_benefits: [],
    };
    const evt = JSON.stringify({ type: 'subscription.canceled', data, created_at: new Date().toISOString() });
    const s = buildSignedPayload(evt, SECRET, 'wh-c', ts);
    const result = handlePolarWebhook(evt, s, SECRET, 'wh-c', ts);
    expect(result.acknowledged).toBe(true);
    expect(result.event.type).toBe('subscription.canceled');
  });

  it('should handle checkout.completed without resolvedTier', () => {
    const data: PolarCheckoutEventData = {
      id: 'co-001',
      status: 'completed',
      customer_email: 'user@example.com',
      product_price_id: 'price-pro',
      subscription_id: 'sub-001',
    };
    const evt = JSON.stringify({ type: 'checkout.completed', data, created_at: new Date().toISOString() });
    const s = buildSignedPayload(evt, SECRET, 'wh-ch', ts);
    const result = handlePolarWebhook(evt, s, SECRET, 'wh-ch', ts);
    expect(result.acknowledged).toBe(true);
    expect(result.resolvedTier).toBeUndefined();
  });

  it('should throw on invalid signature', () => {
    expect(() =>
      handlePolarWebhook(eventStr, 'v1,badsignature', SECRET, webhookId, ts),
    ).toThrow('signature verification failed');
  });
});

describe('mapPolarTierToBenefit', () => {
  it('should map to free when no env vars set', () => {
    delete process.env['POLAR_BENEFIT_PRO'];
    delete process.env['POLAR_BENEFIT_ENTERPRISE'];
    expect(mapPolarTierToBenefit('unknown-benefit')).toBe('free');
  });

  it('should map pro benefit', () => {
    process.env['POLAR_BENEFIT_PRO'] = 'benefit-pro-xyz';
    expect(mapPolarTierToBenefit('benefit-pro-xyz')).toBe('pro');
    delete process.env['POLAR_BENEFIT_PRO'];
  });

  it('should map enterprise benefit', () => {
    process.env['POLAR_BENEFIT_ENTERPRISE'] = 'benefit-ent-xyz';
    expect(mapPolarTierToBenefit('benefit-ent-xyz')).toBe('enterprise');
    delete process.env['POLAR_BENEFIT_ENTERPRISE'];
  });
});
