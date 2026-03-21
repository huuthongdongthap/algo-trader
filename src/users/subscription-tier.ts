// Subscription tier definitions for algo-trade RaaS platform
// Defines feature limits and pricing per tier

export type Tier = 'free' | 'pro' | 'enterprise';

export interface TierLimits {
  /** Max concurrent active strategies */
  maxStrategies: number;
  /** Max capital in USD (Infinity for enterprise) */
  maxCapital: number;
  /** API requests per minute */
  apiRateLimit: number;
  /** Available feature flags */
  features: TierFeature[];
}

export type TierFeature = 'backtesting' | 'optimizer' | 'webhook' | 'multi-market';

/** Tier configuration map */
export const TIER_CONFIG: Record<Tier, TierLimits> = {
  free: {
    maxStrategies: 1,
    maxCapital: 1_000,
    apiRateLimit: 10,
    features: [],
  },
  pro: {
    maxStrategies: 3,
    maxCapital: 50_000,
    apiRateLimit: 60,
    features: ['backtesting', 'multi-market'],
  },
  enterprise: {
    maxStrategies: Infinity,
    maxCapital: Infinity,
    apiRateLimit: 300,
    features: ['backtesting', 'optimizer', 'webhook', 'multi-market'],
  },
};

/** Monthly price in USD */
const MONTHLY_PRICES: Record<Tier, number> = {
  free: 0,
  pro: 29,
  enterprise: 199,
};

/**
 * Get limits for a given tier
 */
export function getTierLimits(tier: Tier): TierLimits {
  return TIER_CONFIG[tier];
}

/**
 * Get monthly price in USD for a tier
 */
export function getMonthlyPrice(tier: Tier): number {
  return MONTHLY_PRICES[tier];
}

/**
 * Check if a tier has a specific feature
 */
export function hasFeature(tier: Tier, feature: TierFeature): boolean {
  return TIER_CONFIG[tier].features.includes(feature);
}

/**
 * Check if tier allows adding more strategies given current count
 */
export function canAddStrategy(tier: Tier, currentCount: number): boolean {
  const { maxStrategies } = TIER_CONFIG[tier];
  return maxStrategies === Infinity || currentCount < maxStrategies;
}

/**
 * Check if tier allows the given capital amount
 */
export function isCapitalAllowed(tier: Tier, capital: number): boolean {
  const { maxCapital } = TIER_CONFIG[tier];
  return maxCapital === Infinity || capital <= maxCapital;
}
