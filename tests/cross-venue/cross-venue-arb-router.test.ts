import { describe, it, expect, vi } from 'vitest';
import { CrossVenueArbRouter, type PolymarketOrderPlacer } from '../../src/cross-venue/cross-venue-arb-router.js';
import type { CrossPlatformOpportunity } from '../../src/kalshi/kalshi-market-scanner.js';
import type { KalshiMarket } from '../../src/kalshi/kalshi-client.js';

const makeMarket = (overrides?: Partial<KalshiMarket>): KalshiMarket => ({
  ticker: 'PRES-2026',
  title: 'Presidential Election',
  subtitle: 'Who wins?',
  status: 'open',
  yes_bid: 55,
  yes_ask: 57,
  no_bid: 42,
  no_ask: 44,
  volume: 5000,
  open_interest: 300,
  close_time: new Date(Date.now() + 86400000).toISOString(),
  ...overrides,
} as KalshiMarket);

const makeOpp = (spread: number, direction: 'buy-kalshi' | 'buy-polymarket' = 'buy-kalshi'): CrossPlatformOpportunity => ({
  kalshiMarket: makeMarket(),
  polymarketConditionId: 'cond-abc',
  kalshiPrice: direction === 'buy-kalshi' ? 0.50 : 0.50 + spread,
  polymarketPrice: direction === 'buy-kalshi' ? 0.50 + spread : 0.50,
  spread,
  direction,
});

describe('CrossVenueArbRouter', () => {
  describe('paper mode', () => {
    it('should execute arbs in paper mode without venue managers', async () => {
      const router = new CrossVenueArbRouter({ paperMode: true, minSpread: 0.03 });
      const opps = [makeOpp(0.05), makeOpp(0.04)];

      const executions = await router.executeArbs(opps);
      expect(executions).toHaveLength(2);
      expect(executions[0].status).toBe('filled');
      expect(executions[0].buyVenue).toBe('kalshi');
      expect(executions[0].sellVenue).toBe('polymarket');
      expect(executions[0].buyOrderId).toContain('paper-buy');
      expect(executions[0].expectedProfit).toBeGreaterThan(0);
    });

    it('should filter out opportunities below minSpread', async () => {
      const router = new CrossVenueArbRouter({ paperMode: true, minSpread: 0.05 });
      const opps = [makeOpp(0.03), makeOpp(0.06)];

      const executions = await router.executeArbs(opps);
      expect(executions).toHaveLength(1);
      expect(executions[0].opportunity.spread).toBe(0.06);
    });

    it('should respect maxConcurrent limit', async () => {
      const router = new CrossVenueArbRouter({ paperMode: true, minSpread: 0.01, maxConcurrent: 2 });
      const opps = [makeOpp(0.05), makeOpp(0.04), makeOpp(0.03)];

      const executions = await router.executeArbs(opps);
      expect(executions).toHaveLength(2);
    });

    it('should set correct buy/sell venues for buy-polymarket direction', async () => {
      const router = new CrossVenueArbRouter({ paperMode: true, minSpread: 0.01 });
      const opp = makeOpp(0.05, 'buy-polymarket');

      const [exec] = await router.executeArbs([opp]);
      expect(exec.buyVenue).toBe('polymarket');
      expect(exec.sellVenue).toBe('kalshi');
    });
  });

  describe('live mode', () => {
    it('should fail when venue managers not wired', async () => {
      const router = new CrossVenueArbRouter({ paperMode: false, minSpread: 0.01 });
      const [exec] = await router.executeArbs([makeOpp(0.05)]);

      expect(exec.status).toBe('failed');
      expect(exec.error).toContain('not wired');
    });

    it('should execute live arb through venue managers', async () => {
      const router = new CrossVenueArbRouter({ paperMode: false, minSpread: 0.01, maxPositionSize: 50 });
      const mockKalshi = { submitOrder: vi.fn(async () => ({ id: 'kalshi-ord-1' })) };
      const mockPoly: PolymarketOrderPlacer = { placeOrder: vi.fn(async () => 'poly-ord-1') };
      router.wireVenues(mockKalshi, mockPoly);

      const [exec] = await router.executeArbs([makeOpp(0.05)]);
      expect(exec.status).toBe('filled');
      expect(exec.buyOrderId).toBe('kalshi-ord-1');
      expect(exec.sellOrderId).toBe('poly-ord-1');
      expect(mockKalshi.submitOrder).toHaveBeenCalledOnce();
      expect(mockPoly.placeOrder).toHaveBeenCalledOnce();
    });

    it('should handle execution errors gracefully', async () => {
      const router = new CrossVenueArbRouter({ paperMode: false, minSpread: 0.01 });
      const mockKalshi = { submitOrder: vi.fn(async () => { throw new Error('Kalshi API down'); }) };
      const mockPoly: PolymarketOrderPlacer = { placeOrder: vi.fn(async () => 'poly-1') };
      router.wireVenues(mockKalshi, mockPoly);

      const [exec] = await router.executeArbs([makeOpp(0.05)]);
      expect(exec.status).toBe('failed');
      expect(exec.error).toContain('Kalshi API down');
    });
  });

  describe('getExecutions / getActiveCount', () => {
    it('should track all executions', async () => {
      const router = new CrossVenueArbRouter({ paperMode: true, minSpread: 0.01 });
      await router.executeArbs([makeOpp(0.05), makeOpp(0.04)]);

      expect(router.getExecutions()).toHaveLength(2);
      // Paper mode fills immediately, so no active (pending) arbs
      expect(router.getActiveCount()).toBe(0);
    });
  });
});
