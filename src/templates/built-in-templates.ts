// Built-in strategy templates – 5 pre-configured templates covering common strategies
import type { StrategyTemplate } from './template-registry.js';

// --- Polymarket Arbitrage ---

/** Conservative cross-market arb: min 3% spread, small position size */
const PM_ARB_CONSERVATIVE: StrategyTemplate = {
  id: 'pm-arb-conservative',
  name: 'Polymarket Arb – Conservative',
  description:
    'Cross-market arbitrage on Polymarket binary markets. Requires ≥3% net spread. '
    + 'Small position size ($50) to limit exposure. Suitable for beginners.',
  category: 'polymarket',
  strategyName: 'cross-market-arb',
  defaultParams: {
    minNetProfitPct: 0.03,      // 3% minimum net profit
    gasCostUsdc: 0.3,
    slippageEstimate: 0.005,
    defaultSizeUsdc: 50,
    scanIntervalMs: 10_000,
    maxBookAgeMs: 15_000,
  },
  requiredParams: [],
  riskLevel: 'low',
};

/** Aggressive cross-market arb: min 1% spread, large position size */
const PM_ARB_AGGRESSIVE: StrategyTemplate = {
  id: 'pm-arb-aggressive',
  name: 'Polymarket Arb – Aggressive',
  description:
    'Cross-market arbitrage with tighter spread threshold (1%) and larger '
    + 'position size ($500). Higher throughput, higher exposure.',
  category: 'polymarket',
  strategyName: 'cross-market-arb',
  defaultParams: {
    minNetProfitPct: 0.01,      // 1% minimum net profit
    gasCostUsdc: 0.3,
    slippageEstimate: 0.005,
    defaultSizeUsdc: 500,
    scanIntervalMs: 3_000,
    maxBookAgeMs: 8_000,
  },
  requiredParams: [],
  riskLevel: 'high',
};

// --- CEX Grid Trading ---

/** BTC/USDT sideways grid: 10 grids, ~5% range around entry */
const GRID_BTC_SIDEWAYS: StrategyTemplate = {
  id: 'grid-btc-sideways',
  name: 'BTC/USDT Sideways Grid',
  description:
    'Grid trading on BTC/USDT for sideways/ranging markets. '
    + '10 grid levels across a 5% price range. $100 per grid level.',
  category: 'cex-grid',
  strategyName: 'grid-trading',
  defaultParams: {
    exchange: 'binance',
    symbol: 'BTC/USDT',
    // lowerPrice / upperPrice must be supplied by user at instantiation
    // (dynamic: depends on current BTC price)
    gridCount: 10,
    amountPerGrid: 100,         // USDT per grid level
  },
  requiredParams: ['lowerPrice', 'upperPrice'],
  riskLevel: 'medium',
};

// --- DCA ---

/** ETH weekly DCA: $100 per buy, low risk accumulation */
const DCA_ETH_WEEKLY: StrategyTemplate = {
  id: 'dca-eth-weekly',
  name: 'ETH Weekly DCA',
  description:
    'Dollar-cost averaging into ETH/USDT on a weekly schedule. '
    + '$100 per buy. Long-term accumulation strategy with minimal active management.',
  category: 'dca',
  strategyName: 'dca-bot',
  defaultParams: {
    exchange: 'binance',
    symbol: 'ETH/USDT',
    intervalMs: 7 * 24 * 60 * 60 * 1000,   // 1 week in ms
    amountUsdt: 100,
    orderType: 'market',
    maxSlippagePct: 0.005,
  },
  requiredParams: [],
  riskLevel: 'low',
};

// --- Funding Rate Carry ---

/** Funding rate arbitrage: 0.01% threshold, delta-neutral */
const FUNDING_RATE_CARRY: StrategyTemplate = {
  id: 'funding-rate-carry',
  name: 'Funding Rate Carry',
  description:
    'Delta-neutral funding rate arbitrage. Long spot + short perp when funding '
    + 'rate exceeds 0.01% per 8h. Medium risk due to execution/liquidation exposure.',
  category: 'cex-perp',
  strategyName: 'funding-rate-arb',
  defaultParams: {
    exchange: 'binance',
    minFundingRatePct: 0.0001,  // 0.01% per 8h
    positionSizeUsdt: 200,
    maxLeverage: 2,
    checkIntervalMs: 30_000,
    closeBelowRatePct: 0.00005, // close when rate drops below 0.005%
  },
  requiredParams: [],
  riskLevel: 'medium',
};

// --- Export ---

export const ALL_TEMPLATES: StrategyTemplate[] = [
  PM_ARB_CONSERVATIVE,
  PM_ARB_AGGRESSIVE,
  GRID_BTC_SIDEWAYS,
  DCA_ETH_WEEKLY,
  FUNDING_RATE_CARRY,
];

export {
  PM_ARB_CONSERVATIVE,
  PM_ARB_AGGRESSIVE,
  GRID_BTC_SIDEWAYS,
  DCA_ETH_WEEKLY,
  FUNDING_RATE_CARRY,
};
