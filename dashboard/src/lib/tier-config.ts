/**
 * Single source of truth for tier limits across landing page, pricing page, and account page.
 * All tier limit values MUST be read from this file — never hardcoded in components.
 */

export type Tier = 'free' | 'pro' | 'enterprise';

export interface TierLimits {
  tradesPerDay: string;
  dailyLossCap: string;
  maxPosition: string;
  activeStrategies: string;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    tradesPerDay: '5',
    dailyLossCap: '$50',
    maxPosition: '$500',
    activeStrategies: '1',
  },
  pro: {
    tradesPerDay: 'Unlimited',
    dailyLossCap: '$500',
    maxPosition: '$5,000',
    activeStrategies: '5',
  },
  enterprise: {
    tradesPerDay: 'Unlimited',
    dailyLossCap: 'Custom',
    maxPosition: 'Custom',
    activeStrategies: 'Unlimited',
  },
};

/** Returns tier limits, defaulting to free if tier is unrecognized. */
export function getTierLimits(tier: string): TierLimits {
  return TIER_LIMITS[tier as Tier] ?? TIER_LIMITS.free;
}
