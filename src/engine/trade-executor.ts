// Unified trade execution across Polymarket, CEX, and DEX
import type { TradeResult, MarketType, OrderSide, StrategyName } from '../core/types.js';
import { logger } from '../core/logger.js';
import { generateId } from '../core/utils.js';

/** Trade request from any strategy */
export interface TradeRequest {
  marketType: MarketType;
  exchange: string;
  symbol: string;
  side: OrderSide;
  size: string;
  price?: string;
  strategy: StrategyName;
  dryRun?: boolean;
}

/** Execution adapters injected at engine startup */
export interface ExecutionAdapters {
  polymarket?: {
    executeOrder(side: OrderSide, tokenId: string, price: string, size: string): Promise<TradeResult>;
  };
  cex?: {
    executeLimitOrder(exchange: string, symbol: string, side: OrderSide, price: string, amount: string): Promise<TradeResult>;
    executeMarketOrder(exchange: string, symbol: string, side: OrderSide, amount: string): Promise<TradeResult>;
  };
  dex?: {
    executeSwap(chain: string, tokenIn: string, tokenOut: string, amountIn: string): Promise<TradeResult>;
  };
}

/**
 * Routes trade requests to the appropriate execution adapter.
 * Supports dry-run mode for paper trading.
 */
export class TradeExecutor {
  private adapters: ExecutionAdapters;
  private tradeLog: TradeResult[] = [];

  constructor(adapters: ExecutionAdapters) {
    this.adapters = adapters;
  }

  async execute(request: TradeRequest): Promise<TradeResult> {
    logger.info(`Executing trade: ${request.side} ${request.size} ${request.symbol}`, 'TradeExecutor', {
      type: request.marketType,
      exchange: request.exchange,
      strategy: request.strategy,
    });

    if (request.dryRun) {
      return this.simulateTrade(request);
    }

    let result: TradeResult;
    switch (request.marketType) {
      case 'polymarket':
        result = await this.executePolymarket(request);
        break;
      case 'cex':
        result = await this.executeCex(request);
        break;
      case 'dex':
        result = await this.executeDex(request);
        break;
      default:
        throw new Error(`Unsupported market type: ${request.marketType}`);
    }

    this.tradeLog.push(result);
    logger.info(`Trade executed: ${result.orderId}`, 'TradeExecutor', {
      fillPrice: result.fillPrice,
      fillSize: result.fillSize,
      fees: result.fees,
    });
    return result;
  }

  getTradeLog(): TradeResult[] {
    return [...this.tradeLog];
  }

  private async executePolymarket(req: TradeRequest): Promise<TradeResult> {
    if (!this.adapters.polymarket) throw new Error('Polymarket adapter not configured');
    return this.adapters.polymarket.executeOrder(req.side, req.symbol, req.price ?? '0', req.size);
  }

  private async executeCex(req: TradeRequest): Promise<TradeResult> {
    if (!this.adapters.cex) throw new Error('CEX adapter not configured');
    if (req.price) {
      return this.adapters.cex.executeLimitOrder(req.exchange, req.symbol, req.side, req.price, req.size);
    }
    return this.adapters.cex.executeMarketOrder(req.exchange, req.symbol, req.side, req.size);
  }

  private async executeDex(req: TradeRequest): Promise<TradeResult> {
    if (!this.adapters.dex) throw new Error('DEX adapter not configured');
    return this.adapters.dex.executeSwap(req.exchange, req.symbol, '', req.size);
  }

  /** Paper trading: simulate fill at requested price */
  private simulateTrade(req: TradeRequest): TradeResult {
    logger.info(`[DRY-RUN] Simulated: ${req.side} ${req.size} @ ${req.price ?? 'market'}`, 'TradeExecutor');
    return {
      orderId: generateId('sim'),
      marketId: req.symbol,
      side: req.side,
      fillPrice: req.price ?? '0',
      fillSize: req.size,
      fees: '0',
      timestamp: Date.now(),
      strategy: req.strategy,
    };
  }
}
