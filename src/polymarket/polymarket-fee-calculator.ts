// Polymarket dynamic fee calculator — March 30, 2026 fee expansion
// Taker fees vary by category + distance from 50%. Maker rebates per category.

export type PolymarketCategory =
  | 'crypto' | 'politics' | 'finance' | 'tech'
  | 'culture' | 'sports' | 'science' | 'pop_culture'
  | 'geopolitics' | 'world_events';

export interface FeeSchedule {
  /** Minimum taker fee (at probability near 50%), e.g. 0.0035 = 0.35% */
  minTakerFee: number;
  /** Maximum taker fee (at probability near 0% or 100%), e.g. 0.018 = 1.80% */
  maxTakerFee: number;
  /** Maker rebate as fraction of taker fees collected */
  makerRebatePct: number;
  /** True for exempt categories (no fees at all) */
  exempt: boolean;
}

/** Fee schedules per Polymarket category — effective March 30, 2026 */
export const FEE_SCHEDULES: Record<PolymarketCategory, FeeSchedule> = {
  crypto:       { minTakerFee: 0.0035, maxTakerFee: 0.018,  makerRebatePct: 0.20, exempt: false },
  politics:     { minTakerFee: 0.0020, maxTakerFee: 0.010,  makerRebatePct: 0.25, exempt: false },
  finance:      { minTakerFee: 0.0020, maxTakerFee: 0.010,  makerRebatePct: 0.50, exempt: false },
  tech:         { minTakerFee: 0.0020, maxTakerFee: 0.010,  makerRebatePct: 0.20, exempt: false },
  culture:      { minTakerFee: 0.0020, maxTakerFee: 0.010,  makerRebatePct: 0.20, exempt: false },
  sports:       { minTakerFee: 0.0015, maxTakerFee: 0.0075, makerRebatePct: 0.20, exempt: false },
  science:      { minTakerFee: 0.0015, maxTakerFee: 0.0075, makerRebatePct: 0.20, exempt: false },
  pop_culture:  { minTakerFee: 0.0015, maxTakerFee: 0.0075, makerRebatePct: 0.20, exempt: false },
  geopolitics:  { minTakerFee: 0,      maxTakerFee: 0,      makerRebatePct: 0,    exempt: true  },
  world_events: { minTakerFee: 0,      maxTakerFee: 0,      makerRebatePct: 0,    exempt: true  },
};

/**
 * Calculate dynamic taker fee based on category and probability.
 * Fee scales with distance from 50% — closer to 0%/100% = higher fee.
 * Returns fee as decimal (e.g., 0.018 for 1.8%).
 */
export function calcTakerFee(category: PolymarketCategory, probability: number): number {
  const schedule = FEE_SCHEDULES[category];
  if (schedule.exempt) return 0;

  const distance = Math.abs(probability - 0.5); // 0.0 at center, 0.5 at extremes
  const ratio = Math.min(distance / 0.5, 1.0);  // clamp to [0, 1]
  return schedule.minTakerFee + (schedule.maxTakerFee - schedule.minTakerFee) * ratio;
}

/**
 * Calculate maker rebate from taker fees collected.
 * Returns rebate amount in same units as takerFeeCollected.
 */
export function calcMakerRebate(
  category: PolymarketCategory,
  takerFeeCollected: number,
): number {
  return takerFeeCollected * FEE_SCHEDULES[category].makerRebatePct;
}

/** Total cost for a taker order including dynamic fee. */
export function netCostTaker(
  amount: number,
  category: PolymarketCategory,
  probability: number,
): number {
  const feeRate = calcTakerFee(category, probability);
  return amount * (1 + feeRate);
}

/** Estimated net profit for a maker order including rebate. */
export function netProfitMaker(
  amount: number,
  category: PolymarketCategory,
  estimatedTakerVolume: number,
  probability = 0.5,
): number {
  const feeRate = calcTakerFee(category, probability);
  const schedule = FEE_SCHEDULES[category];
  const rebate = estimatedTakerVolume * feeRate * schedule.makerRebatePct;
  return amount + rebate;
}

// ── Category classification from market description ────────────────────────

const CATEGORY_KEYWORDS: Record<PolymarketCategory, string[]> = {
  crypto:       ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'token', 'defi', 'blockchain', 'solana', 'sol'],
  politics:     ['president', 'election', 'congress', 'senate', 'democrat', 'republican', 'vote', 'governor', 'trump', 'biden'],
  finance:      ['fed', 'interest rate', 'gdp', 'inflation', 'stock', 'sp500', 's&p', 'nasdaq', 'treasury', 'fomc'],
  tech:         ['ai', 'openai', 'apple', 'google', 'microsoft', 'nvidia', 'spacex', 'launch', 'chip'],
  culture:      ['oscar', 'grammy', 'album', 'movie', 'netflix', 'show', 'concert', 'festival'],
  sports:       ['nba', 'nfl', 'mlb', 'champion', 'playoff', 'world cup', 'super bowl', 'finals', 'match'],
  science:      ['climate', 'nasa', 'mars', 'vaccine', 'cdc', 'pandemic', 'research', 'study'],
  pop_culture:  ['celebrity', 'kardashian', 'tiktok', 'instagram', 'viral', 'meme', 'influencer'],
  geopolitics:  ['war', 'nato', 'sanctions', 'ukraine', 'china', 'taiwan', 'ceasefire', 'un security'],
  world_events: ['earthquake', 'hurricane', 'tsunami', 'wildfire', 'disaster', 'famine'],
};

/**
 * Classify a market description into a Polymarket fee category.
 * Falls back to 'politics' (most common Polymarket category) if no match.
 */
export function classifyMarketCategory(description: string): PolymarketCategory {
  const lower = ` ${description.toLowerCase()} `; // pad for word boundary matching
  let bestCategory: PolymarketCategory = 'politics';
  let bestScore = 0;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [PolymarketCategory, string[]][]) {
    const score = keywords.filter(kw => {
      // Use word boundary regex for short keywords (<=4 chars) to avoid false positives
      if (kw.length <= 4) {
        return new RegExp(`\\b${kw}\\b`).test(lower);
      }
      return lower.includes(kw);
    }).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }
  return bestCategory;
}
