import { describe, it, expect } from 'vitest';
import {
  parseTradingViewAlert,
  parseGenericSignal,
  parseCustomSignal,
  type SignalTemplate,
} from '../../src/webhooks/signal-parser.js';

describe('parseTradingViewAlert', () => {
  it('should parse valid TradingView alert', () => {
    const result = parseTradingViewAlert({
      ticker: 'BTC',
      action: 'buy',
      price: '50000',
      quantity: '0.1',
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe('tradingview');
    expect(result!.symbol).toBe('BTC');
    expect(result!.side).toBe('buy');
    expect(result!.price).toBe('50000');
    expect(result!.size).toBe('0.1');
  });

  it('should accept symbol field alias', () => {
    const result = parseTradingViewAlert({ symbol: 'ETH', action: 'sell' });
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('ETH');
    expect(result!.side).toBe('sell');
  });

  it('should use close as price fallback', () => {
    const result = parseTradingViewAlert({ ticker: 'BTC', action: 'buy', close: '49000' });
    expect(result!.price).toBe('49000');
  });

  it('should normalize action to lowercase', () => {
    const result = parseTradingViewAlert({ ticker: 'BTC', action: 'BUY' });
    expect(result!.side).toBe('buy');
  });

  it('should return null for missing ticker', () => {
    expect(parseTradingViewAlert({ action: 'buy' })).toBeNull();
  });

  it('should return null for invalid action', () => {
    expect(parseTradingViewAlert({ ticker: 'BTC', action: 'hold' })).toBeNull();
  });

  it('should return null for non-object input', () => {
    expect(parseTradingViewAlert(null)).toBeNull();
    expect(parseTradingViewAlert('string')).toBeNull();
    expect(parseTradingViewAlert(42)).toBeNull();
  });

  it('should parse valid strategy name', () => {
    const result = parseTradingViewAlert({ ticker: 'BTC', action: 'buy', strategy: 'grid-trading' });
    expect(result!.strategy).toBe('grid-trading');
  });

  it('should ignore invalid strategy name', () => {
    const result = parseTradingViewAlert({ ticker: 'BTC', action: 'buy', strategy: 'unknown' });
    expect(result!.strategy).toBeUndefined();
  });

  it('should use body time if numeric', () => {
    const result = parseTradingViewAlert({ ticker: 'BTC', action: 'buy', time: 1700000000 });
    expect(result!.timestamp).toBe(1700000000);
  });
});

describe('parseGenericSignal', () => {
  it('should parse valid generic signal', () => {
    const result = parseGenericSignal({ ticker: 'SOL', action: 'sell', price: '100' });
    expect(result).not.toBeNull();
    expect(result!.source).toBe('generic');
    expect(result!.symbol).toBe('SOL');
    expect(result!.side).toBe('sell');
  });

  it('should return null for missing fields', () => {
    expect(parseGenericSignal({ ticker: 'SOL' })).toBeNull();
    expect(parseGenericSignal({ action: 'buy' })).toBeNull();
  });

  it('should store raw body', () => {
    const body = { ticker: 'ETH', action: 'buy' };
    const result = parseGenericSignal(body);
    expect(result!.raw).toBe(body);
  });
});

describe('parseCustomSignal', () => {
  const template: SignalTemplate = {
    source: 'mybot',
    symbolField: 'pair',
    sideField: 'direction',
    priceField: 'entry',
    sizeField: 'qty',
    buyValue: 'long',
    sellValue: 'short',
  };

  it('should parse custom signal with template mapping', () => {
    const result = parseCustomSignal(
      { pair: 'BTC/USDT', direction: 'long', entry: '50000', qty: '0.5' },
      template,
    );
    expect(result).not.toBeNull();
    expect(result!.source).toBe('mybot');
    expect(result!.symbol).toBe('BTC/USDT');
    expect(result!.side).toBe('buy');
    expect(result!.price).toBe('50000');
    expect(result!.size).toBe('0.5');
  });

  it('should map sell value', () => {
    const result = parseCustomSignal({ pair: 'ETH', direction: 'short' }, template);
    expect(result!.side).toBe('sell');
  });

  it('should return null for unknown direction value', () => {
    expect(parseCustomSignal({ pair: 'ETH', direction: 'neutral' }, template)).toBeNull();
  });

  it('should use default buy/sell when no buyValue/sellValue', () => {
    const simple: SignalTemplate = { symbolField: 'sym', sideField: 'act' };
    const result = parseCustomSignal({ sym: 'BTC', act: 'buy' }, simple);
    expect(result!.side).toBe('buy');
    expect(result!.source).toBe('custom');
  });

  it('should return null for missing symbol', () => {
    expect(parseCustomSignal({ direction: 'long' }, template)).toBeNull();
  });
});
