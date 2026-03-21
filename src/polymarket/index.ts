// Polymarket module barrel export
export { ClobClient } from './clob-client.js';
export type { RawMarket, RawOrderBook, OrderBookLevel, RawPrice, OrderArgs, RawOrderResponse } from './clob-client.js';

export { OrderBookStream } from './orderbook-stream.js';
export type { OrderBookState, OrderBookUpdate } from './orderbook-stream.js';

export { OrderManager } from './order-manager.js';
export type { OrderRecord } from './order-manager.js';

export { MarketScanner } from './market-scanner.js';
export type { MarketOpportunity, ScanResult } from './market-scanner.js';
