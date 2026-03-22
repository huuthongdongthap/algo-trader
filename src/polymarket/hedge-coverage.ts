// Hedge coverage calculator — ported from PolyClaw (chainstacklabs/polyclaw)
// Calculates coverage metrics and tier classification for covering portfolios
//
// Coverage formula:
//   Coverage = P(target wins) + P(target loses) × P(cover fires | target loses)
//
// Tier classification:
//   TIER 1 (HIGH):     >=95% coverage — near-arbitrage
//   TIER 2 (GOOD):     90-95% — strong hedges
//   TIER 3 (MODERATE): 85-90% — decent but noticeable risk
//   TIER 4 (LOW):      <85% — speculative

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const MIN_COVERAGE = 0.85;
export const NECESSARY_PROBABILITY = 0.98;

export type TierLabel = 'HIGH' | 'GOOD' | 'MODERATE' | 'LOW';

interface TierThreshold {
  threshold: number;
  tier: number;
  label: TierLabel;
  description: string;
}

export const TIER_THRESHOLDS: TierThreshold[] = [
  { threshold: 0.95, tier: 1, label: 'HIGH',     description: 'near-arbitrage' },
  { threshold: 0.90, tier: 2, label: 'GOOD',     description: 'strong hedge' },
  { threshold: 0.85, tier: 3, label: 'MODERATE', description: 'decent hedge' },
  { threshold: 0.00, tier: 4, label: 'LOW',      description: 'speculative' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoverageMetrics {
  coverage: number;
  lossProbability: number;
  expectedProfit: number;
}

export type PositionSide = 'YES' | 'NO';

export interface MarketPrices {
  id: string;
  question: string;
  slug: string;
  yesPrice: number;
  noPrice: number;
}

export interface HedgePortfolio {
  targetId: string;
  targetQuestion: string;
  targetSlug: string;
  targetPosition: PositionSide;
  targetPrice: number;
  coverId: string;
  coverQuestion: string;
  coverSlug: string;
  coverPosition: PositionSide;
  coverPrice: number;
  coverProbability: number;
  relationship: string;
  totalCost: number;
  profit: number;
  profitPct: number;
  coverage: number;
  lossProbability: number;
  expectedProfit: number;
  tier: number;
  tierLabel: TierLabel;
}

// ---------------------------------------------------------------------------
// Metrics calculation
// ---------------------------------------------------------------------------

/**
 * Calculate coverage and expected value for a hedge portfolio.
 *
 * @param targetPrice - Price of target position (= P(target pays out))
 * @param coverProbability - P(cover fires | target doesn't pay out)
 * @param totalCost - Total cost of both positions
 */
export function calculateCoverageMetrics(
  targetPrice: number,
  coverProbability: number,
  totalCost: number,
): CoverageMetrics {
  const pTarget = targetPrice;
  const pNotTarget = 1 - targetPrice;

  // Coverage = P(get paid) = P(target wins) + P(target loses) × P(cover fires)
  const coverage = pTarget + pNotTarget * coverProbability;

  // Loss probability = P(both fail)
  const lossProbability = pNotTarget * (1 - coverProbability);

  // Expected payout is coverage (each payout is $1)
  const expectedProfit = coverage - totalCost;

  return {
    coverage: round4(coverage),
    lossProbability: round4(lossProbability),
    expectedProfit: round4(expectedProfit),
  };
}

/**
 * Classify portfolio into tier based on coverage.
 * Returns [tierNumber, tierLabel].
 */
export function classifyTier(coverage: number): [number, TierLabel] {
  for (const { threshold, tier, label } of TIER_THRESHOLDS) {
    if (coverage >= threshold) return [tier, label];
  }
  return [4, 'LOW'];
}

/** Get description for a tier number. */
export function getTierDescription(tier: number): string {
  const entry = TIER_THRESHOLDS.find(t => t.tier === tier);
  return entry?.description ?? 'speculative';
}

// ---------------------------------------------------------------------------
// Portfolio building
// ---------------------------------------------------------------------------

/**
 * Build a single portfolio from target and cover markets.
 * Returns null if invalid (cost out of range or coverage below minimum).
 */
export function buildPortfolio(
  targetMarket: MarketPrices,
  coverMarket: MarketPrices,
  targetPosition: PositionSide,
  coverPosition: PositionSide,
  coverProbability: number,
  relationship: string,
): HedgePortfolio | null {
  const targetPrice = targetPosition === 'YES' ? targetMarket.yesPrice : targetMarket.noPrice;
  const coverPrice = coverPosition === 'YES' ? coverMarket.yesPrice : coverMarket.noPrice;
  const totalCost = targetPrice + coverPrice;

  // Skip invalid costs
  if (totalCost <= 0 || totalCost > 2.0) return null;

  const metrics = calculateCoverageMetrics(targetPrice, coverProbability, totalCost);

  // Skip low coverage
  if (metrics.coverage < MIN_COVERAGE) return null;

  const [tier, tierLabel] = classifyTier(metrics.coverage);

  return {
    targetId: targetMarket.id,
    targetQuestion: targetMarket.question,
    targetSlug: targetMarket.slug,
    targetPosition,
    targetPrice: round4(targetPrice),
    coverId: coverMarket.id,
    coverQuestion: coverMarket.question,
    coverSlug: coverMarket.slug,
    coverPosition,
    coverPrice: round4(coverPrice),
    coverProbability,
    relationship,
    totalCost: round4(totalCost),
    profit: round4(1.0 - totalCost),
    profitPct: totalCost > 0 ? round2((1.0 - totalCost) / totalCost * 100) : 0,
    ...metrics,
    tier,
    tierLabel,
  };
}

// ---------------------------------------------------------------------------
// Portfolio filtering & sorting
// ---------------------------------------------------------------------------

/** Filter portfolios by maximum tier (1 = best only). */
export function filterByTier(portfolios: HedgePortfolio[], maxTier = 2): HedgePortfolio[] {
  return portfolios.filter(p => p.tier <= maxTier);
}

/** Filter portfolios by minimum coverage threshold. */
export function filterByCoverage(portfolios: HedgePortfolio[], minCoverage = MIN_COVERAGE): HedgePortfolio[] {
  return portfolios.filter(p => p.coverage >= minCoverage);
}

/** Sort portfolios by tier (ascending) then coverage (descending). */
export function sortPortfolios(portfolios: HedgePortfolio[]): HedgePortfolio[] {
  return [...portfolios].sort((a, b) => a.tier - b.tier || b.coverage - a.coverage);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round4(n: number): number { return Math.round(n * 10000) / 10000; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
