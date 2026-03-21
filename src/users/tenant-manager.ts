// Per-user strategy isolation and tenant context management
// Each tenant gets isolated strategy instances with tier-enforced limits

import type { StrategyName, StrategyConfig } from '../core/types.js';
import type { User } from './user-store.js';
import { getTierLimits, canAddStrategy, isCapitalAllowed } from './subscription-tier.js';

export interface TenantContext {
  userId: string;
  /** Strategy names allowed for this tenant */
  strategies: StrategyName[];
  /** Max capital in USD enforced by tier */
  capitalLimit: number;
  /** Currently running strategy names */
  activeStrategies: Set<StrategyName>;
  /** Cumulative trade count */
  tradeCount: number;
  /** Realized P&L as decimal string */
  realizedPnl: string;
  /** Configs registered per strategy */
  strategyConfigs: Map<StrategyName, StrategyConfig>;
}

export interface TenantStats {
  userId: string;
  activeStrategyCount: number;
  tradeCount: number;
  realizedPnl: string;
  capitalLimit: number;
}

export class TenantManager {
  /** userId → TenantContext */
  private contexts = new Map<string, TenantContext>();

  /**
   * Register a new tenant with their user profile and initial strategy configs.
   * Enforces tier limits on capital and strategy count.
   */
  registerTenant(user: User, configs: StrategyConfig[]): TenantContext {
    const limits = getTierLimits(user.tier);

    // Clamp configs to tier's maxStrategies
    const allowedConfigs = configs.slice(0, limits.maxStrategies === Infinity ? configs.length : limits.maxStrategies);

    const context: TenantContext = {
      userId: user.id,
      strategies: allowedConfigs.map(c => c.name),
      capitalLimit: limits.maxCapital,
      activeStrategies: new Set(),
      tradeCount: 0,
      realizedPnl: '0',
      strategyConfigs: new Map(allowedConfigs.map(c => [c.name, c])),
    };

    this.contexts.set(user.id, context);
    return context;
  }

  /**
   * Retrieve an existing tenant's context.
   * Returns null if tenant is not registered.
   */
  getTenantContext(userId: string): TenantContext | null {
    return this.contexts.get(userId) ?? null;
  }

  /**
   * Check whether a tenant is allowed to start a given strategy.
   * Validates: tenant exists, strategy is in their list, tier limit not exceeded.
   */
  canStartStrategy(userId: string, strategy: StrategyName): boolean {
    const ctx = this.contexts.get(userId);
    if (!ctx) return false;
    if (!ctx.strategies.includes(strategy)) return false;
    if (ctx.activeStrategies.has(strategy)) return false;

    // Lookup the user's tier by reverse-deriving from capitalLimit
    // We use canAddStrategy with current active count
    const user = this.getUserForContext(ctx);
    if (!user) return false;

    return canAddStrategy(user.tier, ctx.activeStrategies.size);
  }

  /**
   * Mark a strategy as active for a tenant.
   * Returns false if not allowed per canStartStrategy.
   */
  startStrategy(userId: string, strategy: StrategyName): boolean {
    if (!this.canStartStrategy(userId, strategy)) return false;
    this.contexts.get(userId)!.activeStrategies.add(strategy);
    return true;
  }

  /**
   * Mark a strategy as stopped for a tenant.
   */
  stopStrategy(userId: string, strategy: StrategyName): boolean {
    const ctx = this.contexts.get(userId);
    if (!ctx) return false;
    return ctx.activeStrategies.delete(strategy);
  }

  /**
   * Validate that a capital amount is within tier limits for a tenant.
   */
  isCapitalWithinLimit(userId: string, capital: number): boolean {
    const ctx = this.contexts.get(userId);
    if (!ctx) return false;
    const user = this.getUserForContext(ctx);
    if (!user) return false;
    return isCapitalAllowed(user.tier, capital);
  }

  /**
   * Record a completed trade for the tenant (updates counters).
   */
  recordTrade(userId: string, pnlDelta: string): void {
    const ctx = this.contexts.get(userId);
    if (!ctx) return;
    ctx.tradeCount += 1;
    // Simple string-based accumulation; downstream systems use BigDecimal for precision
    const prev = parseFloat(ctx.realizedPnl);
    const delta = parseFloat(pnlDelta);
    ctx.realizedPnl = (prev + delta).toFixed(8);
  }

  /**
   * Get a snapshot of tenant trading stats.
   */
  getTenantStats(userId: string): TenantStats | null {
    const ctx = this.contexts.get(userId);
    if (!ctx) return null;
    return {
      userId: ctx.userId,
      activeStrategyCount: ctx.activeStrategies.size,
      tradeCount: ctx.tradeCount,
      realizedPnl: ctx.realizedPnl,
      capitalLimit: ctx.capitalLimit,
    };
  }

  /** Remove a tenant (e.g. on deactivation) */
  removeTenant(userId: string): boolean {
    return this.contexts.delete(userId);
  }

  /** Internal: look up cached user tier from registered contexts */
  private cachedUsers = new Map<string, User>();

  /** Store user reference at registration time for tier checks */
  registerTenantWithUser(user: User, configs: StrategyConfig[]): TenantContext {
    this.cachedUsers.set(user.id, user);
    return this.registerTenant(user, configs);
  }

  private getUserForContext(ctx: TenantContext): User | null {
    return this.cachedUsers.get(ctx.userId) ?? null;
  }
}
