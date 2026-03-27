/**
 * Tier Configuration
 * ROIaaS - Revenue-as-a-Service License Gating
 *
 * Defines tier-based access control configuration.
 */

import { LicenseTier } from '../../types/license';

export interface TierConfig {
  requestsPerMin: number;
  requestsPerHour: number;
  burstPerSec: number;
  dailyApiLimit: number;
  overagePrice: number;
  features: string[];
}

/**
 * Tier configuration
 */
export const TIER_CONFIG: Record<LicenseTier, TierConfig> = {
  [LicenseTier.FREE]: {
    requestsPerMin: 10,
    requestsPerHour: 100,
    burstPerSec: 2,
    dailyApiLimit: 100,
    overagePrice: 0,
    features: ['basic_strategies', 'live_trading', 'basic_backtest'],
  },
  [LicenseTier.PRO]: {
    requestsPerMin: 100,
    requestsPerHour: 1000,
    burstPerSec: 10,
    dailyApiLimit: 10000,
    overagePrice: 0.01,
    features: ['ml_strategies', 'premium_data', 'advanced_optimization', 'hyperparameter_tuning', 'ml_model_weights'],
  },
  [LicenseTier.ENTERPRISE]: {
    requestsPerMin: 1000,
    requestsPerHour: 10000,
    burstPerSec: 50,
    dailyApiLimit: 100000,
    overagePrice: 0.005,
    features: ['all_pro_features', 'arbitrage_scanning', 'multi_exchange_trading', 'custom_strategies', 'priority_support'],
  },
};

/**
 * Feature to Tier mapping
 */
export const FEATURE_TIER_MAP: Record<string, LicenseTier> = {
  // FREE features
  basic_strategies: LicenseTier.FREE,
  live_trading: LicenseTier.FREE,
  basic_backtest: LicenseTier.FREE,

  // PRO features
  ml_strategies: LicenseTier.PRO,
  premium_data: LicenseTier.PRO,
  advanced_optimization: LicenseTier.PRO,
  hyperparameter_tuning: LicenseTier.PRO,
  ml_model_weights: LicenseTier.PRO,
  tenant_management: LicenseTier.PRO,

  // ENTERPRISE features
  arbitrage_scanning: LicenseTier.ENTERPRISE,
  multi_exchange_trading: LicenseTier.ENTERPRISE,
  custom_strategies: LicenseTier.ENTERPRISE,
  priority_support: LicenseTier.ENTERPRISE,
};
