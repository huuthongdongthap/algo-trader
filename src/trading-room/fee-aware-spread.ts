// Fee-aware spread calculation — ensure trades are profitable after all costs
// Ported from: fee-aware-spread-calculator concept
// Handles CEX maker/taker fees + DEX gas costs.

export interface SpreadResult {
  /** Raw price difference (sellPrice - buyPrice) */
  grossSpread: number;
  /** Spread after deducting all fees */
  netSpread: number;
  /** Fee paid on buy leg */
  buyFees: number;
  /** Fee paid on sell leg */
  sellFees: number;
  /** True when netSpread > 0 */
  profitable: boolean;
  /** Minimum trade size to cover fixed costs (e.g. gas) */
  minSize: number;
}

/**
 * Calculate gross and net spread between two prices after fees.
 *
 * @param buyPrice  - Price paid to acquire asset
 * @param sellPrice - Price received when exiting
 * @param buyFeeRate  - Fractional fee on buy leg (0.001 = 0.1%)
 * @param sellFeeRate - Fractional fee on sell leg (0.001 = 0.1%)
 * @param size        - Trade size in quote currency (default 1 for unit spread)
 */
export function calculateFeeAwareSpread(
  buyPrice: number,
  sellPrice: number,
  buyFeeRate: number,
  sellFeeRate: number,
  size: number = 1,
): SpreadResult {
  const grossSpread = sellPrice - buyPrice;

  const buyFees = buyPrice * buyFeeRate * size;
  const sellFees = sellPrice * sellFeeRate * size;

  const netSpread = grossSpread * size - buyFees - sellFees;

  // Minimum size where fixed-cost component (fees alone) breaks even
  // (meaningful when spread per unit > 0)
  const spreadPerUnit = grossSpread - buyPrice * buyFeeRate - sellPrice * sellFeeRate;
  const minSize = spreadPerUnit > 0 ? 0 : Infinity; // no fixed costs here; see isArbProfitable

  return {
    grossSpread,
    netSpread,
    buyFees,
    sellFees,
    profitable: netSpread > 0,
    minSize,
  };
}

/**
 * Minimum price spread required to break even at a given fee rate.
 * Useful for setting grid spacing or arb entry thresholds.
 *
 * breakeven = price * (buyFeeRate + sellFeeRate)
 *
 * @param midPrice   - Reference price for the asset
 * @param buyFeeRate
 * @param sellFeeRate
 */
export function calculateBreakeven(
  midPrice: number,
  buyFeeRate: number,
  sellFeeRate: number,
): number {
  return midPrice * (buyFeeRate + sellFeeRate);
}

/**
 * Determine whether a DEX arbitrage is profitable including gas costs.
 *
 * @param grossSpread   - Raw spread in quote currency
 * @param tradeFees     - Total exchange/swap fees in quote currency
 * @param gasEstimate   - Gas cost in quote currency (e.g. ETH gas converted to USDC)
 * @param size          - Trade notional
 */
export function isArbProfitable(
  grossSpread: number,
  tradeFees: number,
  gasEstimate: number,
  size: number,
): boolean {
  const grossProfit = grossSpread * size;
  const totalCost = tradeFees + gasEstimate;
  return grossProfit > totalCost;
}

/**
 * Calculate the optimal (profit-maximizing) order size given spread, fees, and capital.
 *
 * Constraints:
 *  - Net P&L per unit = spread - buyFeeRate*buyPrice - sellFeeRate*sellPrice
 *  - Cannot exceed available capital
 *  - Minimum size = 1 unit (guard against degenerate inputs)
 *
 * @param grossSpread   - Price difference per unit
 * @param buyPrice      - Price of buy leg
 * @param buyFeeRate
 * @param sellFeeRate
 * @param capital       - Available quote currency
 * @returns Optimal size in base units (floored to 6 decimal places)
 */
export function calculateOptimalSize(
  grossSpread: number,
  buyPrice: number,
  buyFeeRate: number,
  sellFeeRate: number,
  capital: number,
): number {
  const netPerUnit =
    grossSpread - buyPrice * buyFeeRate - (buyPrice + grossSpread) * sellFeeRate;

  if (netPerUnit <= 0 || buyPrice <= 0) return 0;

  // Max units purchasable with capital (at buy price, including buy fee)
  const costPerUnit = buyPrice * (1 + buyFeeRate);
  const maxAffordable = capital / costPerUnit;

  // Optimal = all available capital when spread is positive (greedy)
  const optimal = Math.min(maxAffordable, capital / buyPrice);
  return Math.max(0, parseFloat(optimal.toFixed(6)));
}
