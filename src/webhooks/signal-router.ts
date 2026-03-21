// Signal router - maps incoming webhook signals to trading strategies
// Matches by source and symbol pattern, applies optional transform
import type { OrderSide, StrategyName } from '../core/types.js';
import type { TradingSignal } from './signal-parser.js';

/** Minimal trade request passed to the matched strategy */
export interface TradeRequest {
  symbol: string;
  side: OrderSide;
  price?: string;
  size?: string;
  strategy: StrategyName;
  /** Unix ms timestamp from the originating signal */
  timestamp: number;
}

/** Optional transform applied to a signal before producing a TradeRequest */
export type SignalTransform = (signal: TradingSignal) => Partial<TradeRequest>;

/** A route definition: source + symbol pattern → target strategy */
export interface SignalRoute {
  /** Signal source to match (e.g. 'tradingview'). '*' matches any source. */
  source: string;
  /** Regex pattern matched against signal.symbol */
  symbolPattern: RegExp;
  targetStrategy: StrategyName;
  transform?: SignalTransform;
}

/** Result returned when a signal matches a route */
export interface RouteResult {
  strategy: StrategyName;
  tradeRequest: TradeRequest;
}

// ---------------------------------------------------------------------------
// Default routes applied when no custom routes match
// ---------------------------------------------------------------------------

const DEFAULT_ROUTES: SignalRoute[] = [
  {
    source: 'tradingview',
    symbolPattern: /.*/,
    targetStrategy: 'grid-trading',
  },
  {
    source: 'custom',
    symbolPattern: /.*/,
    targetStrategy: 'market-maker',
  },
];

// ---------------------------------------------------------------------------
// SignalRouter
// ---------------------------------------------------------------------------

/**
 * Routes incoming TradingSignals to strategies based on registered routes.
 * Routes are evaluated in registration order; first match wins.
 * Falls back to DEFAULT_ROUTES if no registered route matches.
 */
export class SignalRouter {
  private readonly routes: SignalRoute[] = [];

  /**
   * Register a signal→strategy mapping.
   * Registered routes take priority over default routes.
   */
  addRoute(route: SignalRoute): void {
    this.routes.push(route);
  }

  /**
   * Find the first matching route for the given signal.
   * Returns null if no route (including defaults) matches.
   */
  routeSignal(signal: TradingSignal): RouteResult | null {
    const matched = this.findRoute(signal, this.routes) ?? this.findRoute(signal, DEFAULT_ROUTES);
    if (!matched) return null;

    const base: TradeRequest = {
      symbol: signal.symbol,
      side: signal.side,
      price: signal.price,
      size: signal.size,
      strategy: matched.targetStrategy,
      timestamp: signal.timestamp,
    };

    // Apply optional transform (overrides specific fields)
    const overrides = matched.transform ? matched.transform(signal) : {};

    return {
      strategy: matched.targetStrategy,
      tradeRequest: { ...base, ...overrides, strategy: matched.targetStrategy },
    };
  }

  /** Remove all registered routes (does not affect defaults) */
  clearRoutes(): void {
    this.routes.length = 0;
  }

  /** Number of registered (non-default) routes */
  get routeCount(): number {
    return this.routes.length;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private findRoute(signal: TradingSignal, pool: SignalRoute[]): SignalRoute | null {
    for (const route of pool) {
      const sourceMatch = route.source === '*' || route.source === signal.source;
      const symbolMatch = route.symbolPattern.test(signal.symbol);
      if (sourceMatch && symbolMatch) return route;
    }
    return null;
  }
}
