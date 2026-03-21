// Barrel export for the users module
// Multi-tenant user management: store, tier config, tenant isolation

export { UserStore } from './user-store.js';
export type { User } from './user-store.js';

export { TenantManager } from './tenant-manager.js';
export type { TenantContext, TenantStats } from './tenant-manager.js';

export {
  TIER_CONFIG,
  getTierLimits,
  getMonthlyPrice,
  hasFeature,
  canAddStrategy,
  isCapitalAllowed,
} from './subscription-tier.js';
export type { Tier, TierLimits, TierFeature } from './subscription-tier.js';
