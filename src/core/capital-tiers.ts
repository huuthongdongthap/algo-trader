// Capital tier progression system — gates live trading by validated performance
// Each tier requires minimum paper/live days and profitable days before unlocking

import { logger } from './logger.js';

export interface CapitalTier {
  level: 1 | 2 | 3 | 4;
  maxCapital: number;
  minDryRunDays: number;
  minProfitableDays: number;
}

export const TIERS: CapitalTier[] = [
  { level: 1, maxCapital: 200, minDryRunDays: 14, minProfitableDays: 10 },
  { level: 2, maxCapital: 500, minDryRunDays: 14, minProfitableDays: 10 },
  { level: 3, maxCapital: 1000, minDryRunDays: 14, minProfitableDays: 10 },
  { level: 4, maxCapital: 5000, minDryRunDays: 14, minProfitableDays: 10 },
];

export interface TierProgress {
  tier: CapitalTier;
  daysCompleted: number;
  profitableDays: number;
  totalPnl: number;
  canProgress: boolean;
  nextTier: CapitalTier | null;
}

export interface DailyRecord {
  date: string;
  pnl: number;
}

/**
 * Determine current tier based on capital amount.
 */
export function getCurrentTier(capital: number): CapitalTier {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (capital >= TIERS[i].maxCapital) return TIERS[i];
  }
  return TIERS[0];
}

/**
 * Check if trader can progress to next tier.
 */
export function canProgressToNextTier(
  currentTier: CapitalTier,
  dailyRecords: DailyRecord[],
): boolean {
  if (currentTier.level >= 4) return false;

  if (dailyRecords.length < currentTier.minDryRunDays) return false;

  const profitableDays = dailyRecords.filter(r => r.pnl > 0).length;
  if (profitableDays < currentTier.minProfitableDays) return false;

  const totalPnl = dailyRecords.reduce((sum, r) => sum + r.pnl, 0);
  if (totalPnl <= 0) return false;

  return true;
}

/**
 * Get full progress report for current tier.
 */
export function getProgressReport(
  capital: number,
  dailyRecords: DailyRecord[],
): TierProgress {
  const tier = getCurrentTier(capital);
  const profitableDays = dailyRecords.filter(r => r.pnl > 0).length;
  const totalPnl = dailyRecords.reduce((sum, r) => sum + r.pnl, 0);
  const canProgress = canProgressToNextTier(tier, dailyRecords);
  const nextTierIdx = TIERS.findIndex(t => t.level === tier.level) + 1;
  const nextTier = nextTierIdx < TIERS.length ? TIERS[nextTierIdx] : null;

  logger.debug('Tier progress', 'capital-tiers', {
    level: tier.level,
    days: dailyRecords.length,
    profitableDays,
    totalPnl,
    canProgress,
  });

  return {
    tier,
    daysCompleted: dailyRecords.length,
    profitableDays,
    totalPnl,
    canProgress,
    nextTier,
  };
}
