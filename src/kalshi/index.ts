// Kalshi module — prediction market API integration
export { KalshiClient } from './kalshi-client.js';
export type {
  KalshiMarket,
  KalshiOrderbook,
  KalshiOrderbookLevel,
  KalshiOrder,
  KalshiBalance,
  KalshiPosition,
} from './kalshi-client.js';

export { KalshiMarketScanner } from './kalshi-market-scanner.js';
export type {
  CrossPlatformOpportunity,
  PolymarketPriceMap,
} from './kalshi-market-scanner.js';

export { KalshiOrderManager } from './kalshi-order-manager.js';
