// Subscription lifecycle manager — maps tiers to Stripe price IDs
// Handles subscribe, upgrade, cancel, and status queries

import { Tier } from '../users/subscription-tier.js';
import { StripeClient } from './stripe-client.js';

// --- Types ---

export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'trialing';

export interface UserSubscription {
  userId: string;
  stripeCustomerId: string;
  stripeSubId: string;
  tier: Tier;
  status: SubscriptionStatus;
  /** Unix timestamp — when current billing period ends */
  currentPeriodEnd: number;
}

// --- Price ID resolution ---

/** Read Stripe price IDs from environment variables */
function getPriceIds(): Record<Tier, string> {
  const free = process.env['STRIPE_PRICE_FREE'] ?? '';
  const pro = process.env['STRIPE_PRICE_PRO'] ?? '';
  const enterprise = process.env['STRIPE_PRICE_ENTERPRISE'] ?? '';
  return { free, pro, enterprise };
}

/** Map Stripe subscription status to internal SubscriptionStatus */
function mapStripeStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case 'active': return 'active';
    case 'past_due': return 'past_due';
    case 'canceled': return 'cancelled';
    case 'trialing': return 'trialing';
    default: return 'cancelled';
  }
}

// --- Manager ---

export class SubscriptionManager {
  /** In-memory store: userId → UserSubscription */
  private readonly subscriptions = new Map<string, UserSubscription>();

  constructor(private readonly stripe: StripeClient) {}

  /**
   * Create a new Stripe customer and subscription for the given tier.
   * Throws if user already has an active subscription.
   */
  async subscribe(
    userId: string,
    email: string,
    name: string,
    tier: Tier,
  ): Promise<UserSubscription> {
    if (this.subscriptions.has(userId)) {
      throw new Error(`User ${userId} already has a subscription. Use upgrade() instead.`);
    }

    const priceIds = getPriceIds();
    const priceId = priceIds[tier];
    if (!priceId) {
      throw new Error(`No Stripe price ID configured for tier "${tier}". Set STRIPE_PRICE_${tier.toUpperCase()}.`);
    }

    const customer = await this.stripe.createCustomer(email, name);
    const sub = await this.stripe.createSubscription(customer.id, priceId);

    const record: UserSubscription = {
      userId,
      stripeCustomerId: customer.id,
      stripeSubId: sub.id,
      tier,
      status: mapStripeStatus(sub.status),
      currentPeriodEnd: sub.current_period_end,
    };

    this.subscriptions.set(userId, record);
    return record;
  }

  /**
   * Upgrade or downgrade an existing subscription to a new tier.
   * Updates the Stripe subscription item in place (immediate proration).
   */
  async upgrade(userId: string, newTier: Tier): Promise<UserSubscription> {
    const existing = this.subscriptions.get(userId);
    if (!existing) {
      throw new Error(`No subscription found for user ${userId}.`);
    }

    const priceIds = getPriceIds();
    const newPriceId = priceIds[newTier];
    if (!newPriceId) {
      throw new Error(`No Stripe price ID configured for tier "${newTier}". Set STRIPE_PRICE_${newTier.toUpperCase()}.`);
    }

    // Fetch current sub to get the subscription item ID
    const currentSub = await this.stripe.getSubscription(existing.stripeSubId);
    const itemId = currentSub.items.data[0]?.id;
    if (!itemId) {
      throw new Error(`Subscription ${existing.stripeSubId} has no items.`);
    }

    const updated = await this.stripe.updateSubscription(existing.stripeSubId, itemId, newPriceId);

    const record: UserSubscription = {
      ...existing,
      tier: newTier,
      status: mapStripeStatus(updated.status),
      currentPeriodEnd: updated.current_period_end,
    };

    this.subscriptions.set(userId, record);
    return record;
  }

  /**
   * Cancel subscription immediately via Stripe DELETE.
   * Marks internal record as cancelled.
   */
  async cancel(userId: string): Promise<UserSubscription> {
    const existing = this.subscriptions.get(userId);
    if (!existing) {
      throw new Error(`No subscription found for user ${userId}.`);
    }

    const cancelled = await this.stripe.cancelSubscription(existing.stripeSubId);

    const record: UserSubscription = {
      ...existing,
      status: mapStripeStatus(cancelled.status),
      currentPeriodEnd: cancelled.current_period_end,
    };

    this.subscriptions.set(userId, record);
    return record;
  }

  /**
   * Return current subscription status by fetching live data from Stripe.
   * Syncs local record with latest Stripe state.
   */
  async getStatus(userId: string): Promise<UserSubscription> {
    const existing = this.subscriptions.get(userId);
    if (!existing) {
      throw new Error(`No subscription found for user ${userId}.`);
    }

    const live = await this.stripe.getSubscription(existing.stripeSubId);

    const record: UserSubscription = {
      ...existing,
      status: mapStripeStatus(live.status),
      currentPeriodEnd: live.current_period_end,
    };

    this.subscriptions.set(userId, record);
    return record;
  }
}
