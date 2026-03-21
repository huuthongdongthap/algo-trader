// Capital allocation across strategies: equal, kelly, or fixed modes
import type { StrategyConfig, StrategyName } from '../core/types.js';
import { kellyFraction } from '../core/risk-manager.js';

export type AllocationStrategy = 'equal' | 'kelly' | 'fixed';

/** Per-strategy performance stats required for Kelly allocation */
export interface StrategyStats {
  name: StrategyName;
  winRate: number;
  avgWin: number;
  avgLoss: number;
}

/** Constraints for allocation per strategy */
export interface AllocationConstraints {
  /** Minimum capital per strategy (default 0) */
  minPerStrategy?: number;
  /** Maximum capital per strategy (default totalCapital) */
  maxPerStrategy?: number;
}

/**
 * Calculate capital allocations across enabled strategies.
 * Returns Map<StrategyName, amount> where sum <= totalCapital.
 */
export function calculateAllocations(
  totalCapital: number,
  strategies: StrategyConfig[],
  mode: AllocationStrategy,
  stats?: StrategyStats[],
  constraints?: AllocationConstraints,
): Map<StrategyName, number> {
  const result = new Map<StrategyName, number>();
  const enabled = strategies.filter(s => s.enabled);

  if (enabled.length === 0 || totalCapital <= 0) return result;

  const minPer = constraints?.minPerStrategy ?? 0;
  const maxPer = constraints?.maxPerStrategy ?? totalCapital;

  if (mode === 'equal') {
    _applyEqual(totalCapital, enabled, minPer, maxPer, result);
  } else if (mode === 'kelly') {
    _applyKelly(totalCapital, enabled, stats ?? [], minPer, maxPer, result);
  } else {
    _applyFixed(totalCapital, enabled, minPer, maxPer, result);
  }

  _validateSum(result, totalCapital);
  return result;
}

// ── private helpers ──────────────────────────────────────────────────────────

function _clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function _applyEqual(
  totalCapital: number,
  enabled: StrategyConfig[],
  min: number,
  max: number,
  out: Map<StrategyName, number>,
): void {
  const share = totalCapital / enabled.length;
  for (const s of enabled) {
    out.set(s.name, _clamp(share, min, max));
  }
}

function _applyKelly(
  totalCapital: number,
  enabled: StrategyConfig[],
  stats: StrategyStats[],
  min: number,
  max: number,
  out: Map<StrategyName, number>,
): void {
  const statsMap = new Map(stats.map(s => [s.name, s]));
  const fractions: Map<StrategyName, number> = new Map();
  let totalFraction = 0;

  for (const s of enabled) {
    const st = statsMap.get(s.name);
    const f = st ? kellyFraction(st.winRate, st.avgWin, st.avgLoss) : 0;
    fractions.set(s.name, f);
    totalFraction += f;
  }

  // Fall back to equal if no kelly signals
  if (totalFraction === 0) {
    _applyEqual(totalCapital, enabled, min, max, out);
    return;
  }

  for (const s of enabled) {
    const weight = (fractions.get(s.name) ?? 0) / totalFraction;
    out.set(s.name, _clamp(weight * totalCapital, min, max));
  }
}

function _applyFixed(
  totalCapital: number,
  enabled: StrategyConfig[],
  min: number,
  max: number,
  out: Map<StrategyName, number>,
): void {
  let allocated = 0;
  for (const s of enabled) {
    const requested = parseFloat(s.capitalAllocation) || 0;
    const amount = _clamp(Math.min(requested, totalCapital - allocated), min, max);
    out.set(s.name, amount);
    allocated += amount;
  }
}

/** Throws if total allocations exceed capital (with 1-cent tolerance) */
function _validateSum(allocations: Map<StrategyName, number>, totalCapital: number): void {
  let sum = 0;
  for (const v of allocations.values()) sum += v;
  if (sum > totalCapital + 0.01) {
    throw new Error(`Allocation sum ${sum.toFixed(2)} exceeds totalCapital ${totalCapital.toFixed(2)}`);
  }
}
