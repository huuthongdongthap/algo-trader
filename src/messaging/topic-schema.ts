/**
 * NATS Topic Schema
 * Centralized topic definitions for the event-driven architecture
 *
 * Naming: {domain}.{entity}.{action}
 * Wildcards: * (single token), > (multi-token tail)
 */

export const Topics = {
  // Market data events
  MARKET_UPDATE: 'market.*.update',
  MARKET_ORDERBOOK: 'market.*.orderbook',
  MARKET_PRICE: 'market.*.price',

  // Signal engine events
  SIGNAL_SIMPLE_ARB: 'signal.simple-arb.detected',
  SIGNAL_CROSS_MARKET: 'signal.cross-market.candidate',
  SIGNAL_DELTA_NEUTRAL: 'signal.delta-neutral.candidate',
  SIGNAL_MULTI_LEG: 'signal.multi-leg.optimized',

  // Intelligence events
  INTELLIGENCE_DEPENDENCIES: 'intelligence.dependencies.updated',
  INTELLIGENCE_SENTIMENT: 'intelligence.sentiment.updated',

  // Risk events
  RISK_ALERT: 'risk.alert',
  RISK_CIRCUIT_BREAKER: 'risk.circuit-breaker.triggered',
  RISK_POSITION_LIMIT: 'risk.position-limit.reached',

  // Order execution events
  ORDER_PLACED: 'order.placed',
  ORDER_FILLED: 'order.filled',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_FAILED: 'order.failed',

  // System events
  SYSTEM_HEALTH: 'system.health',
  SYSTEM_METRICS: 'system.metrics',
} as const;

export type TopicName = (typeof Topics)[keyof typeof Topics];

/** Build a market-specific topic by replacing wildcard */
export function marketTopic(template: string, marketId: string): string {
  return template.replace('*', marketId);
}
