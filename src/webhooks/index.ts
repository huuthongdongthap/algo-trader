// Barrel export for webhooks module
export type { TradingSignal, SignalTemplate } from './signal-parser.js';
export { parseTradingViewAlert, parseGenericSignal, parseCustomSignal } from './signal-parser.js';

export type { SignalHandler } from './webhook-server.js';
export { createWebhookServer, stopWebhookServer } from './webhook-server.js';

export type { TradeRequest, SignalTransform, SignalRoute, RouteResult } from './signal-router.js';
export { SignalRouter } from './signal-router.js';
