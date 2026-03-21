/**
 * algo-trade JavaScript Client SDK
 * Public surface: client class + all types + error class.
 */
export { AlgoTradeClient } from './algo-trade-client.js';
export { SdkError } from './sdk-auth.js';
export type { SdkConfig } from './sdk-auth.js';
export type {
  // Core domain
  OrderSide,
  StrategyName,
  TradeResult,
  // Responses
  HealthResponse,
  StatusResponse,
  TradeListResponse,
  PnlResponse,
  StrategyActionRequest,
  StrategyActionResponse,
  // Future stubs
  MarketplaceListResponse,
  BacktestRequest,
  BacktestResponse,
} from './sdk-types.js';
