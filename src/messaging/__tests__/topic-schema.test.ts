/**
 * Topic Schema Tests
 * Tests NATS topic definitions and helper functions
 */

import { describe, it, expect } from 'vitest';
import { Topics, marketTopic } from '../topic-schema';

describe('Topic Schema', () => {
  describe('Topics constants', () => {
    it('should define market data topics', () => {
      expect(Topics.MARKET_UPDATE).toBe('market.*.update');
      expect(Topics.MARKET_ORDERBOOK).toBe('market.*.orderbook');
      expect(Topics.MARKET_PRICE).toBe('market.*.price');
    });

    it('should define signal topics', () => {
      expect(Topics.SIGNAL_SIMPLE_ARB).toBe('signal.simple-arb.detected');
      expect(Topics.SIGNAL_CROSS_MARKET).toBe('signal.cross-market.candidate');
      expect(Topics.SIGNAL_DELTA_NEUTRAL).toBe('signal.delta-neutral.candidate');
      expect(Topics.SIGNAL_MULTI_LEG).toBe('signal.multi-leg.optimized');
    });

    it('should define intelligence topics', () => {
      expect(Topics.INTELLIGENCE_DEPENDENCIES).toBe('intelligence.dependencies.updated');
      expect(Topics.INTELLIGENCE_SENTIMENT).toBe('intelligence.sentiment.updated');
    });

    it('should define risk topics', () => {
      expect(Topics.RISK_ALERT).toBe('risk.alert');
      expect(Topics.RISK_CIRCUIT_BREAKER).toBe('risk.circuit-breaker.triggered');
      expect(Topics.RISK_POSITION_LIMIT).toBe('risk.position-limit.reached');
    });

    it('should define order topics', () => {
      expect(Topics.ORDER_PLACED).toBe('order.placed');
      expect(Topics.ORDER_FILLED).toBe('order.filled');
      expect(Topics.ORDER_CANCELLED).toBe('order.cancelled');
      expect(Topics.ORDER_FAILED).toBe('order.failed');
    });

    it('should define system topics', () => {
      expect(Topics.SYSTEM_HEALTH).toBe('system.health');
      expect(Topics.SYSTEM_METRICS).toBe('system.metrics');
    });
  });

  describe('marketTopic helper', () => {
    it('should replace wildcard with market ID', () => {
      const topic = marketTopic(Topics.MARKET_UPDATE, 'polymarket_1');
      expect(topic).toBe('market.polymarket_1.update');
    });

    it('should handle different market IDs', () => {
      const marketIds = ['BTCUSD', 'ETHUSD', 'SPY_CLOSE'];
      const template = Topics.MARKET_PRICE;

      const results = marketIds.map(id => marketTopic(template, id));
      expect(results[0]).toBe('market.BTCUSD.price');
      expect(results[1]).toBe('market.ETHUSD.price');
      expect(results[2]).toBe('market.SPY_CLOSE.price');
    });

    it('should handle market ID with special characters', () => {
      const topic = marketTopic(Topics.MARKET_ORDERBOOK, 'BTC/USDT');
      expect(topic).toBe('market.BTC/USDT.orderbook');
    });

    it('should replace only first wildcard', () => {
      const topic = marketTopic('test.*.*.value', 'market1');
      expect(topic).toBe('test.market1.*.value');
    });
  });
});
