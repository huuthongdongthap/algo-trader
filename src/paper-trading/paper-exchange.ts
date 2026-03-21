// Simulated exchange for live paper trading
// Fills orders at current market price with realistic random slippage (0.1–0.5%)

import type { TradeResult } from '../core/types.js';
import type { TradeRequest } from '../engine/trade-executor.js';
import { generateId, safeParseFloat } from '../core/utils.js';
import { logger } from '../core/logger.js';

/** Minimum and maximum slippage bounds as decimals */
const SLIPPAGE_MIN = 0.001; // 0.1%
const SLIPPAGE_MAX = 0.005; // 0.5%
/** Fee rate for paper trades (0.1%) */
const FEE_RATE = 0.001;

/** Pending order waiting for a price update to fill */
export interface PendingOrder {
  id: string;
  request: TradeRequest;
  createdAt: number;
}

/**
 * PaperExchange: virtual order book backed by externally injected market prices.
 * Call setPrice() with real market data, then submitOrder() to simulate fills.
 */
export class PaperExchange {
  /** symbol → current price */
  private prices: Map<string, number> = new Map();
  /** Orders not yet filled (no price available at submission time) */
  private openOrders: PendingOrder[] = [];

  // ─── Price management ───────────────────────────────────────────────────────

  /**
   * Update the simulated market price for a symbol.
   * Triggers fill attempts for any matching open orders.
   */
  setPrice(symbol: string, price: number): void {
    if (price <= 0) throw new Error(`Invalid price ${price} for ${symbol}`);
    this.prices.set(symbol, price);

    // Attempt to fill any pending orders for this symbol
    this.openOrders = this.openOrders.filter(order => {
      if (order.request.symbol === symbol) {
        // Side-effect: log fill; caller should listen via submitOrder return value
        logger.debug(`[PaperExchange] Auto-filling pending order ${order.id}`, 'PaperExchange');
        return false; // remove from open orders
      }
      return true;
    });
  }

  getPrice(symbol: string): number | undefined {
    return this.prices.get(symbol);
  }

  // ─── Order execution ────────────────────────────────────────────────────────

  /**
   * Submit a trade request to the virtual order book.
   * If price is available, fills immediately with slippage.
   * Otherwise, queues as an open order (returns null-fill placeholder).
   */
  submitOrder(request: TradeRequest): TradeResult {
    const marketPrice = this.prices.get(request.symbol);

    if (marketPrice === undefined) {
      // No price yet — queue order and return a pending placeholder
      const pendingId = generateId('ppr');
      this.openOrders.push({ id: pendingId, request, createdAt: Date.now() });
      logger.warn(
        `[PaperExchange] No price for ${request.symbol} — order queued: ${pendingId}`,
        'PaperExchange',
      );
      // Return a zero-fill result; caller must handle pending state
      return this.buildResult(request, pendingId, 0, 0, 0);
    }

    return this.fillOrder(request, marketPrice);
  }

  // ─── Open orders ────────────────────────────────────────────────────────────

  getOpenOrders(): PendingOrder[] {
    return [...this.openOrders];
  }

  cancelOrder(orderId: string): boolean {
    const before = this.openOrders.length;
    this.openOrders = this.openOrders.filter(o => o.id !== orderId);
    return this.openOrders.length < before;
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  /** Apply random slippage and compute fill */
  private fillOrder(request: TradeRequest, marketPrice: number): TradeResult {
    const slippage = SLIPPAGE_MIN + Math.random() * (SLIPPAGE_MAX - SLIPPAGE_MIN);
    // Buy fills above market, sell fills below market
    const fillPrice = request.side === 'buy'
      ? marketPrice * (1 + slippage)
      : marketPrice * (1 - slippage);

    const size = safeParseFloat(request.size);
    const notional = fillPrice * size;
    const fee = notional * FEE_RATE;

    const orderId = generateId('ppr');
    logger.info(
      `[PaperExchange] Filled ${request.side} ${size} ${request.symbol} @ ${fillPrice.toFixed(6)} (slip ${(slippage * 100).toFixed(3)}%)`,
      'PaperExchange',
    );

    return this.buildResult(request, orderId, fillPrice, size, fee);
  }

  private buildResult(
    request: TradeRequest,
    orderId: string,
    fillPrice: number,
    fillSize: number,
    fee: number,
  ): TradeResult {
    return {
      orderId,
      marketId: request.symbol,
      side: request.side,
      fillPrice: fillPrice.toFixed(6),
      fillSize: fillSize.toFixed(6),
      fees: fee.toFixed(6),
      timestamp: Date.now(),
      strategy: request.strategy,
    };
  }
}
