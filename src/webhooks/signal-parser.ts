// Webhook signal parser - handles TradingView, generic, and custom formats
// Returns null on invalid/missing required fields
import type { OrderSide, StrategyName } from '../core/types.js';

/** Normalized trading signal from any webhook source */
export interface TradingSignal {
  source: string;
  symbol: string;
  side: OrderSide;
  price?: string;
  size?: string;
  strategy?: StrategyName;
  timestamp: number;
  /** Original raw payload */
  raw: unknown;
}

/** User-defined field mapping for custom signals */
export interface SignalTemplate {
  source?: string;
  symbolField: string;
  sideField: string;
  priceField?: string;
  sizeField?: string;
  strategyField?: string;
  buyValue?: string;
  sellValue?: string;
}

/** Validate OrderSide value */
function toOrderSide(value: unknown): OrderSide | null {
  if (value === 'buy' || value === 'sell') return value;
  return null;
}

/** Validate StrategyName value */
function toStrategyName(value: unknown): StrategyName | undefined {
  const valid: StrategyName[] = [
    'cross-market-arb',
    'market-maker',
    'grid-trading',
    'dca-bot',
    'funding-rate-arb',
  ];
  return valid.includes(value as StrategyName) ? (value as StrategyName) : undefined;
}

/** Coerce to string if truthy */
function str(v: unknown): string | undefined {
  return v != null && v !== '' ? String(v) : undefined;
}

/**
 * Parse TradingView webhook alert JSON.
 * Expected fields: ticker, action (buy|sell), price?, quantity?, strategy?
 */
export function parseTradingViewAlert(body: unknown): TradingSignal | null {
  if (typeof body !== 'object' || body === null) return null;

  const b = body as Record<string, unknown>;

  const symbol = str(b['ticker'] ?? b['symbol']);
  const side = toOrderSide(
    typeof b['action'] === 'string' ? b['action'].toLowerCase() : b['action'],
  );

  if (!symbol || !side) return null;

  return {
    source: 'tradingview',
    symbol,
    side,
    price: str(b['price'] ?? b['close']),
    size: str(b['quantity'] ?? b['size'] ?? b['amount']),
    strategy: toStrategyName(b['strategy']),
    timestamp: typeof b['time'] === 'number' ? b['time'] : Date.now(),
    raw: body,
  };
}

/**
 * Parse generic signal format.
 * Expected fields: action (buy|sell), ticker, price?, quantity?
 */
export function parseGenericSignal(body: unknown): TradingSignal | null {
  if (typeof body !== 'object' || body === null) return null;

  const b = body as Record<string, unknown>;

  const symbol = str(b['ticker'] ?? b['symbol']);
  const side = toOrderSide(
    typeof b['action'] === 'string' ? b['action'].toLowerCase() : b['action'],
  );

  if (!symbol || !side) return null;

  return {
    source: 'generic',
    symbol,
    side,
    price: str(b['price']),
    size: str(b['quantity'] ?? b['size']),
    strategy: toStrategyName(b['strategy']),
    timestamp: Date.now(),
    raw: body,
  };
}

/**
 * Parse custom signal using a user-defined field mapping template.
 * Maps arbitrary field names to the TradingSignal interface.
 */
export function parseCustomSignal(
  body: unknown,
  template: SignalTemplate,
): TradingSignal | null {
  if (typeof body !== 'object' || body === null) return null;

  const b = body as Record<string, unknown>;

  const symbol = str(b[template.symbolField]);
  if (!symbol) return null;

  // Normalize side using optional buy/sell value mapping
  const rawSide = b[template.sideField];
  let side: OrderSide | null = null;

  if (template.buyValue !== undefined || template.sellValue !== undefined) {
    if (rawSide === template.buyValue) side = 'buy';
    else if (rawSide === template.sellValue) side = 'sell';
  } else {
    side = toOrderSide(typeof rawSide === 'string' ? rawSide.toLowerCase() : rawSide);
  }

  if (!side) return null;

  return {
    source: template.source ?? 'custom',
    symbol,
    side,
    price: template.priceField ? str(b[template.priceField]) : undefined,
    size: template.sizeField ? str(b[template.sizeField]) : undefined,
    strategy: template.strategyField ? toStrategyName(b[template.strategyField]) : undefined,
    timestamp: Date.now(),
    raw: body,
  };
}
