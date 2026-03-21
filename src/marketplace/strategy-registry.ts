// Strategy metadata registry for the algo-trade marketplace
// In-memory registry with validation — persisted separately by strategy-store

export type StrategyCategory =
  | 'arbitrage'
  | 'market-making'
  | 'trend-following'
  | 'mean-reversion'
  | 'dca';

export interface StrategyPerformanceStats {
  /** Annualized return as decimal (0.45 = 45%) */
  annualizedReturn: number;
  /** Max drawdown as decimal (0.15 = 15%) */
  maxDrawdown: number;
  /** Win rate as decimal (0.62 = 62%) */
  winRate: number;
  /** Number of backtested trades */
  backtestTrades: number;
  /** Sharpe ratio */
  sharpeRatio: number;
}

export interface StrategyListing {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: StrategyCategory;
  performanceStats: StrategyPerformanceStats;
  /** Price in USDC (string to avoid float precision issues) */
  priceUsdc: string;
  downloads: number;
  /** Average rating 0-5 */
  rating: number;
  createdAt: number;
  updatedAt: number;
}

/** Required fields that must be present and non-empty */
const REQUIRED_FIELDS: (keyof StrategyListing)[] = [
  'id', 'name', 'description', 'author', 'version', 'category',
  'performanceStats', 'priceUsdc',
];

const VALID_CATEGORIES = new Set<StrategyCategory>([
  'arbitrage', 'market-making', 'trend-following', 'mean-reversion', 'dca',
]);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate a listing has all required fields and correct types */
export function validateListing(listing: Partial<StrategyListing>): ValidationResult {
  const errors: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (listing[field] === undefined || listing[field] === null || listing[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (listing.category && !VALID_CATEGORIES.has(listing.category)) {
    errors.push(`Invalid category: ${listing.category}. Must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
  }

  if (listing.rating !== undefined && (listing.rating < 0 || listing.rating > 5)) {
    errors.push('rating must be between 0 and 5');
  }

  if (listing.priceUsdc !== undefined && isNaN(parseFloat(listing.priceUsdc))) {
    errors.push('priceUsdc must be a valid numeric string');
  }

  const stats = listing.performanceStats;
  if (stats) {
    if (stats.winRate < 0 || stats.winRate > 1) errors.push('winRate must be between 0 and 1');
    if (stats.maxDrawdown < 0 || stats.maxDrawdown > 1) errors.push('maxDrawdown must be between 0 and 1');
  }

  return { valid: errors.length === 0, errors };
}

/** In-memory registry for fast lookup and search */
export class StrategyRegistry {
  private listings = new Map<string, StrategyListing>();

  /** Register or update a listing (validates before storing) */
  register(listing: StrategyListing): ValidationResult {
    const result = validateListing(listing);
    if (!result.valid) return result;
    this.listings.set(listing.id, { ...listing });
    return { valid: true, errors: [] };
  }

  /** Lookup by id — returns undefined if not found */
  lookup(id: string): StrategyListing | undefined {
    return this.listings.get(id);
  }

  /** Search by optional category and/or keyword (matches name, description, author) */
  search(opts: { category?: StrategyCategory; keyword?: string } = {}): StrategyListing[] {
    let results = [...this.listings.values()];

    if (opts.category) {
      results = results.filter(l => l.category === opts.category);
    }

    if (opts.keyword) {
      const kw = opts.keyword.toLowerCase();
      results = results.filter(
        l =>
          l.name.toLowerCase().includes(kw) ||
          l.description.toLowerCase().includes(kw) ||
          l.author.toLowerCase().includes(kw),
      );
    }

    return results;
  }

  /** Remove listing from in-memory registry */
  remove(id: string): boolean {
    return this.listings.delete(id);
  }

  count(): number {
    return this.listings.size;
  }
}
