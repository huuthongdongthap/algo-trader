/**
 * Immutable Trade Audit Tests
 */

import { describe, it, expect } from 'vitest';
import { ImmutableTradeAudit } from '../immutable-trade-audit';

describe('ImmutableTradeAudit', () => {
  describe('append-only logging', () => {
    it('should append entries with incrementing sequence', () => {
      const audit = new ImmutableTradeAudit();
      const e1 = audit.append('trade_decision', 'Buy BTC');
      const e2 = audit.append('trade_executed', 'Order filled');

      expect(e1.sequenceNumber).toBe(1);
      expect(e2.sequenceNumber).toBe(2);
      expect(audit.getEntryCount()).toBe(2);
    });

    it('should log trade decisions with full context', () => {
      const audit = new ImmutableTradeAudit();
      const entry = audit.logTradeDecision(
        'BTC-YES', 'buy', 'momentum_signal',
        2500, 2000, 'own-capital', 'Strong bullish signal'
      );

      expect(entry.eventType).toBe('trade_decision');
      expect(entry.marketId).toBe('BTC-YES');
      expect(entry.kellySize).toBe(2500);
      expect(entry.actualSize).toBe(2000);
      expect(entry.walletLabel).toBe('own-capital');
    });

    it('should log circuit breaker events', () => {
      const audit = new ImmutableTradeAudit();
      const entry = audit.logCircuitBreaker('Loss streak: 3 consecutive', { streak: 3 });

      expect(entry.eventType).toBe('circuit_breaker');
      expect(entry.metadata).toEqual({ streak: 3 });
    });

    it('should log drawdown tier changes', () => {
      const audit = new ImmutableTradeAudit();
      const entry = audit.logDrawdownTierChange('ALERT', 0.05, 95000);

      expect(entry.eventType).toBe('drawdown_tier_change');
      expect(entry.metadata).toEqual({ tier: 'ALERT', drawdownPercent: 0.05, portfolioValue: 95000 });
    });
  });

  describe('SHA-256 hash chain', () => {
    it('should set genesis entry previousHash to 0', () => {
      const audit = new ImmutableTradeAudit();
      const entry = audit.append('trade_decision', 'First trade');
      expect(entry.previousHash).toBe('0');
      expect(entry.hash).toBeTruthy();
      expect(entry.hash.length).toBe(64); // SHA-256 hex = 64 chars
    });

    it('should chain hashes: each entry references previous hash', () => {
      const audit = new ImmutableTradeAudit();
      const e1 = audit.append('trade_decision', 'Trade 1');
      const e2 = audit.append('trade_executed', 'Trade 2');
      const e3 = audit.append('circuit_breaker', 'Breaker tripped');

      expect(e2.previousHash).toBe(e1.hash);
      expect(e3.previousHash).toBe(e2.hash);
    });

    it('should produce different hashes for different entries', () => {
      const audit = new ImmutableTradeAudit();
      const e1 = audit.append('trade_decision', 'Buy');
      const e2 = audit.append('trade_decision', 'Sell');
      expect(e1.hash).not.toBe(e2.hash);
    });
  });

  describe('chain integrity verification', () => {
    it('should verify intact chain', () => {
      const audit = new ImmutableTradeAudit();
      audit.append('trade_decision', 'Trade 1');
      audit.append('trade_executed', 'Trade 2');
      audit.append('circuit_breaker', 'Event 3');

      const result = audit.verifyChainIntegrity();
      expect(result.valid).toBe(true);
    });

    it('should protect internal state from external tampering', () => {
      const audit = new ImmutableTradeAudit();
      audit.append('trade_decision', 'Trade 1');
      audit.append('trade_executed', 'Trade 2');

      // getAuditTrail returns copies — external mutation doesn't affect internal state
      const entries = audit.getAuditTrail();
      (entries[0] as any).reason = 'TAMPERED';

      // Internal chain remains intact
      const result = audit.verifyChainIntegrity();
      expect(result.valid).toBe(true);
    });

    it('should return valid for empty log', () => {
      const audit = new ImmutableTradeAudit();
      expect(audit.verifyChainIntegrity().valid).toBe(true);
    });
  });

  describe('query interface', () => {
    it('should filter by walletLabel', () => {
      const audit = new ImmutableTradeAudit();
      audit.logTradeDecision('BTC', 'buy', 'sig', 100, 100, 'own-capital', 'Own trade');
      audit.logTradeDecision('ETH', 'sell', 'sig', 200, 200, 'managed-client1', 'Managed trade');

      const own = audit.getAuditTrail({ walletLabel: 'own-capital' });
      expect(own.length).toBe(1);
      expect(own[0].walletLabel).toBe('own-capital');
    });

    it('should filter by eventType', () => {
      const audit = new ImmutableTradeAudit();
      audit.append('trade_decision', 'Decision');
      audit.append('circuit_breaker', 'Breaker');
      audit.append('trade_decision', 'Decision 2');

      const decisions = audit.getAuditTrail({ eventType: 'trade_decision' });
      expect(decisions.length).toBe(2);
    });

    it('should filter by date range', () => {
      const audit = new ImmutableTradeAudit();
      audit.append('trade_decision', 'Entry 1');
      audit.append('trade_decision', 'Entry 2');

      const all = audit.getAuditTrail();
      expect(all.length).toBe(2);

      // Filter with future start date should return empty
      const future = audit.getAuditTrail({ startDate: '2099-01-01T00:00:00Z' });
      expect(future.length).toBe(0);
    });

    it('should respect limit', () => {
      const audit = new ImmutableTradeAudit();
      for (let i = 0; i < 10; i++) {
        audit.append('trade_decision', `Entry ${i}`);
      }

      const limited = audit.getAuditTrail({ limit: 3 });
      expect(limited.length).toBe(3);
    });
  });

  describe('latest entry', () => {
    it('should return undefined for empty log', () => {
      const audit = new ImmutableTradeAudit();
      expect(audit.getLatestEntry()).toBeUndefined();
    });

    it('should return the most recent entry', () => {
      const audit = new ImmutableTradeAudit();
      audit.append('trade_decision', 'First');
      audit.append('trade_executed', 'Last');

      expect(audit.getLatestEntry()?.reason).toBe('Last');
    });
  });
});
