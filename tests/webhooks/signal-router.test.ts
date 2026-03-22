import { describe, it, expect } from 'vitest';
import { SignalRouter, type SignalRoute } from '../../src/webhooks/signal-router.js';
import type { TradingSignal } from '../../src/webhooks/signal-parser.js';

function makeSignal(overrides: Partial<TradingSignal> = {}): TradingSignal {
  return {
    source: 'tradingview',
    symbol: 'BTC',
    side: 'buy',
    timestamp: Date.now(),
    raw: {},
    ...overrides,
  };
}

describe('SignalRouter', () => {
  it('should route to default tradingview route', () => {
    const router = new SignalRouter();
    const result = router.routeSignal(makeSignal());
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('grid-trading');
    expect(result!.tradeRequest.symbol).toBe('BTC');
    expect(result!.tradeRequest.side).toBe('buy');
  });

  it('should route custom source to market-maker default', () => {
    const router = new SignalRouter();
    const result = router.routeSignal(makeSignal({ source: 'custom' }));
    expect(result!.strategy).toBe('market-maker');
  });

  it('should prioritize registered routes over defaults', () => {
    const router = new SignalRouter();
    router.addRoute({
      source: 'tradingview',
      symbolPattern: /^BTC$/,
      targetStrategy: 'dca-bot',
    });
    const result = router.routeSignal(makeSignal());
    expect(result!.strategy).toBe('dca-bot');
  });

  it('should match wildcard source', () => {
    const router = new SignalRouter();
    router.addRoute({
      source: '*',
      symbolPattern: /ETH/,
      targetStrategy: 'funding-rate-arb',
    });
    const result = router.routeSignal(makeSignal({ source: 'generic', symbol: 'ETH' }));
    expect(result!.strategy).toBe('funding-rate-arb');
  });

  it('should return null for unmatched source', () => {
    const router = new SignalRouter();
    const result = router.routeSignal(makeSignal({ source: 'unknown-source' }));
    expect(result).toBeNull();
  });

  it('should apply transform override', () => {
    const router = new SignalRouter();
    router.addRoute({
      source: 'tradingview',
      symbolPattern: /.*/,
      targetStrategy: 'grid-trading',
      transform: (sig) => ({ size: '999' }),
    });
    const result = router.routeSignal(makeSignal({ size: '1' }));
    expect(result!.tradeRequest.size).toBe('999');
    expect(result!.tradeRequest.strategy).toBe('grid-trading');
  });

  it('should clear registered routes', () => {
    const router = new SignalRouter();
    router.addRoute({ source: '*', symbolPattern: /.*/, targetStrategy: 'dca-bot' });
    expect(router.routeCount).toBe(1);
    router.clearRoutes();
    expect(router.routeCount).toBe(0);
  });

  it('should match symbol pattern regex', () => {
    const router = new SignalRouter();
    router.addRoute({
      source: 'tradingview',
      symbolPattern: /^SOL/,
      targetStrategy: 'cross-market-arb',
    });
    const match = router.routeSignal(makeSignal({ symbol: 'SOL/USDT' }));
    expect(match!.strategy).toBe('cross-market-arb');

    const noMatch = router.routeSignal(makeSignal({ symbol: 'ETH' }));
    // Falls back to default tradingview route
    expect(noMatch!.strategy).toBe('grid-trading');
  });
});
