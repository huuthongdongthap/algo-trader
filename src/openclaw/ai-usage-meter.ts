// AI usage metering — track API calls and tokens per user per month
// Enforces monthly quotas per tier: Pro=100 calls, Enterprise=unlimited
import { logger } from '../core/logger.js';
import type { Tier } from '../users/subscription-tier.js';

export interface AiUsageRecord {
  userId: string;
  month: string; // YYYY-MM
  callCount: number;
  tokenCount: number;
  lastCallAt: number;
}

/** Monthly AI call limits per tier */
const AI_MONTHLY_LIMITS: Record<Tier, number> = {
  free: 0,
  pro: 100,
  enterprise: Infinity,
};

/** In-memory usage store keyed by `${userId}:${month}` */
const _usage = new Map<string, AiUsageRecord>();

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function getKey(userId: string, month?: string): string {
  return `${userId}:${month ?? currentMonth()}`;
}

/** Record an AI API call for a user */
export function recordAiCall(userId: string, tokens: number): void {
  const month = currentMonth();
  const key = getKey(userId, month);
  const record = _usage.get(key) ?? { userId, month, callCount: 0, tokenCount: 0, lastCallAt: 0 };
  record.callCount++;
  record.tokenCount += tokens;
  record.lastCallAt = Date.now();
  _usage.set(key, record);
}

/** Get usage stats for a user in current month */
export function getAiUsage(userId: string): AiUsageRecord {
  const month = currentMonth();
  const key = getKey(userId, month);
  return _usage.get(key) ?? { userId, month, callCount: 0, tokenCount: 0, lastCallAt: 0 };
}

/** Check if user can make another AI call based on tier quota */
export function canMakeAiCall(userId: string, tier: Tier): { allowed: boolean; remaining: number; limit: number } {
  const limit = AI_MONTHLY_LIMITS[tier];
  if (limit === Infinity) return { allowed: true, remaining: Infinity, limit: Infinity };
  if (limit === 0) return { allowed: false, remaining: 0, limit: 0 };

  const usage = getAiUsage(userId);
  const remaining = Math.max(0, limit - usage.callCount);
  return { allowed: remaining > 0, remaining, limit };
}

/** Get all usage records (for admin dashboard) */
export function getAllAiUsage(): AiUsageRecord[] {
  return [..._usage.values()].sort((a, b) => b.callCount - a.callCount);
}
