/**
 * Dry-Run Executor (Paper Trading Mode)
 * Week 3-4: Risk Management - Simulated orders with realistic P&L tracking
 *
 * Features:
 * - Simulates order execution without real trades
 * - Tracks virtual P&L, positions, and balance
 * - Applies realistic slippage and fees
 * - Persists state to Redis for recovery
 */

import { Redis } from 'ioredis';
import { getRedisClient, type RedisClientType } from '../redis';
import { logger } from '../utils/logger';

export interface DryRunConfig {
  initialBalance: number;
  slippagePercent: number;
  feePercent: number;
  simulateFillRate: number; // 0-1, probability of order fill
}

export interface PaperPosition {
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  openedAt: number;
}

export interface PaperTrade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  requestedPrice: number;
  executedPrice: number;
  fee: number;
  slippage: number;
  status: 'filled' | 'rejected' | 'pending';
  timestamp: number;
  pnl?: number;
}

export interface PaperAccount {
  balance: number;
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
}

export interface ExecutionResult {
  success: boolean;
  trade?: PaperTrade;
  message?: string;
  account?: PaperAccount;
}

export class DryRunExecutor {
  private redis: RedisClientType;
  private config: DryRunConfig;
  private readonly ACCOUNT_KEY = 'paper_trading:account';
  private readonly POSITIONS_KEY = 'paper_trading:positions';
  private readonly TRADES_KEY = 'paper_trading:trades';

  constructor(
    redis?: RedisClientType,
    config?: Partial<DryRunConfig>
  ) {
    this.redis = redis || getRedisClient();
    this.config = {
      initialBalance: 10000, // $10k starting balance
      slippagePercent: 0.001, // 0.1% slippage
      feePercent: 0.001, // 0.1% fee
      simulateFillRate: 0.95, // 95% fill rate
      ...config,
    };
  }

  /**
   * Initialize paper trading account
   */
  async initialize(initialBalance?: number): Promise<PaperAccount> {
    const account: PaperAccount = {
      balance: initialBalance || this.config.initialBalance,
      equity: initialBalance || this.config.initialBalance,
      unrealizedPnl: 0,
      realizedPnl: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
    };

    await this.redis.set(this.ACCOUNT_KEY, JSON.stringify(account));
    await this.redis.del(this.POSITIONS_KEY);
    await this.redis.del(this.TRADES_KEY);

    logger.info(`[DryRun] Account initialized with $${account.balance}`);
    return account;
  }

  /**
   * Get current account status
   */
  async getAccount(): Promise<PaperAccount> {
    const data = await this.redis.get(this.ACCOUNT_KEY);
    if (!data) {
      return this.initialize();
    }
    const account = JSON.parse(data) as PaperAccount;

    // Update equity with unrealized P&L
    const positions = await this.getPositions();
    account.unrealizedPnl = positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);
    account.equity = account.balance + account.unrealizedPnl;

    return account;
  }

  /**
   * Execute simulated buy order
   */
  async buy(symbol: string, quantity: number, currentPrice: number): Promise<ExecutionResult> {
    const account = await this.getAccount();
    const requiredBalance = quantity * currentPrice;

    if (requiredBalance > account.balance) {
      return {
        success: false,
        message: `Insufficient balance: need $${requiredBalance.toFixed(2)}, have $${account.balance.toFixed(2)}`,
      };
    }

    // Simulate fill
    if (Math.random() > this.config.simulateFillRate) {
      return {
        success: false,
        message: 'Order not filled (simulated market conditions)',
      };
    }

    // Apply slippage (buy at slightly higher price)
    const slippage = currentPrice * this.config.slippagePercent;
    const executedPrice = currentPrice + slippage;
    const fee = quantity * executedPrice * this.config.feePercent;
    const totalCost = (quantity * executedPrice) + fee;

    // Create trade record
    const trade: PaperTrade = {
      id: `paper-buy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol,
      side: 'buy',
      quantity,
      requestedPrice: currentPrice,
      executedPrice,
      fee,
      slippage,
      status: 'filled',
      timestamp: Date.now(),
    };

    // Update balance
    account.balance -= totalCost;

    // Update or create position
    await this.updatePosition(symbol, 'long', quantity, executedPrice, currentPrice);

    // Save trade and account
    await this.saveTrade(trade);
    await this.saveAccount(account);

    logger.info(`[DryRun] BUY ${quantity} ${symbol} @ $${executedPrice.toFixed(2)} (slippage: $${slippage.toFixed(4)}, fee: $${fee.toFixed(4)})`);

    return {
      success: true,
      trade,
      account,
    };
  }

  /**
   * Execute simulated sell order
   */
  async sell(symbol: string, quantity: number, currentPrice: number): Promise<ExecutionResult> {
    const positions = await this.getPositions();
    const position = positions.find(p => p.symbol === symbol);

    if (!position || position.quantity < quantity) {
      return {
        success: false,
        message: `Insufficient position: have ${position?.quantity || 0} ${symbol}`,
      };
    }

    // Simulate fill
    if (Math.random() > this.config.simulateFillRate) {
      return {
        success: false,
        message: 'Order not filled (simulated market conditions)',
      };
    }

    // Apply slippage (sell at slightly lower price)
    const slippage = currentPrice * this.config.slippagePercent;
    const executedPrice = currentPrice - slippage;
    const fee = quantity * executedPrice * this.config.feePercent;
    const totalRevenue = (quantity * executedPrice) - fee;

    // Calculate P&L
    const pnl = (executedPrice - position.entryPrice) * quantity - fee;

    // Create trade record
    const trade: PaperTrade = {
      id: `paper-sell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol,
      side: 'sell',
      quantity,
      requestedPrice: currentPrice,
      executedPrice,
      fee,
      slippage,
      status: 'filled',
      timestamp: Date.now(),
      pnl,
    };

    // Update account
    let account = await this.getAccount();
    account.balance += totalRevenue;
    account.realizedPnl += pnl;
    account.totalTrades++;
    if (pnl > 0) {
      account.winningTrades++;
    } else {
      account.losingTrades++;
    }

    // Update position
    await this.reducePosition(symbol, quantity, currentPrice);

    // Save trade and account
    await this.saveTrade(trade);
    await this.saveAccount(account);

    logger.info(`[DryRun] SELL ${quantity} ${symbol} @ $${executedPrice.toFixed(2)} | P&L: $${pnl.toFixed(2)}`);

    return {
      success: true,
      trade,
      account,
    };
  }

  /**
   * Update position (add to existing or create new)
   */
  private async updatePosition(
    symbol: string,
    side: 'long' | 'short',
    quantity: number,
    entryPrice: number,
    currentPrice: number
  ): Promise<void> {
    const positions = await this.getPositions();
    const existing = positions.find(p => p.symbol === symbol && p.side === side);

    if (existing) {
      // Average into existing position
      const totalQuantity = existing.quantity + quantity;
      const avgPrice = ((existing.quantity * existing.entryPrice) + (quantity * entryPrice)) / totalQuantity;
      existing.quantity = totalQuantity;
      existing.entryPrice = avgPrice;
      existing.currentPrice = currentPrice;
      existing.unrealizedPnl = (currentPrice - avgPrice) * totalQuantity;
    } else {
      // New position
      positions.push({
        symbol,
        side,
        quantity,
        entryPrice,
        currentPrice,
        unrealizedPnl: (currentPrice - entryPrice) * quantity,
        openedAt: Date.now(),
      });
    }

    await this.redis.set(this.POSITIONS_KEY, JSON.stringify(positions));
  }

  /**
   * Reduce position (partial or full close)
   */
  private async reducePosition(symbol: string, quantity: number, currentPrice: number): Promise<void> {
    const positions = await this.getPositions();
    const position = positions.find(p => p.symbol === symbol);

    if (!position) return;

    position.quantity -= quantity;
    position.currentPrice = currentPrice;
    position.unrealizedPnl = (currentPrice - position.entryPrice) * position.quantity;

    if (position.quantity <= 0) {
      // Remove closed position
      const index = positions.indexOf(position);
      if (index > -1) {
        positions.splice(index, 1);
      }
    }

    await this.redis.set(this.POSITIONS_KEY, JSON.stringify(positions));
  }

  /**
   * Get all open positions
   */
  async getPositions(): Promise<PaperPosition[]> {
    const data = await this.redis.get(this.POSITIONS_KEY);
    if (!data) return [];
    return JSON.parse(data) as PaperPosition[];
  }

  /**
   * Get specific position
   */
  async getPosition(symbol: string): Promise<PaperPosition | null> {
    const positions = await this.getPositions();
    return positions.find(p => p.symbol === symbol) || null;
  }

  /**
   * Get trade history
   */
  async getTradeHistory(limit: number = 50): Promise<PaperTrade[]> {
    const data = await this.redis.lrange(this.TRADES_KEY, 0, limit - 1);
    return data.map(t => JSON.parse(t) as PaperTrade);
  }

  /**
   * Get performance metrics
   */
  async getPerformance(): Promise<{
    totalReturn: number;
    totalReturnPercent: number;
    winRate: number;
    profitFactor: number;
    sharpeRatio: number;
  }> {
    const account = await this.getAccount();
    const trades = await this.getTradeHistory(1000);

    const totalReturn = account.realizedPnl + account.unrealizedPnl;
    const totalReturnPercent = (totalReturn / this.config.initialBalance) * 100;
    const winRate = account.totalTrades > 0
      ? (account.winningTrades / account.totalTrades) * 100
      : 0;

    const winningTrades = trades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = trades.filter(t => (t.pnl || 0) < 0);

    const totalWins = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));

    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // Simple Sharpe calculation (annualized, assuming daily returns)
    const dailyReturns = this.calculateDailyReturns(trades);
    const avgReturn = dailyReturns.length > 0
      ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
      : 0;
    const stdDev = Math.sqrt(
      dailyReturns.map(r => Math.pow(r - avgReturn, 2)).reduce((a, b) => a + b, 0) / dailyReturns.length
    ) || 1;
    const sharpeRatio = (avgReturn / stdDev) * Math.sqrt(252); // Annualized

    return {
      totalReturn,
      totalReturnPercent,
      winRate,
      profitFactor,
      sharpeRatio,
    };
  }

  private calculateDailyReturns(trades: PaperTrade[]): number[] {
    const dailyPnl = new Map<string, number>();

    for (const trade of trades) {
      const date = new Date(trade.timestamp).toISOString().split('T')[0];
      const current = dailyPnl.get(date) || 0;
      dailyPnl.set(date, current + (trade.pnl || 0));
    }

    return Array.from(dailyPnl.values());
  }

  /**
   * Update prices for all positions (call periodically)
   */
  async updatePrices(prices: Map<string, number>): Promise<PaperPosition[]> {
    const positions = await this.getPositions();

    for (const position of positions) {
      if (prices.has(position.symbol)) {
        position.currentPrice = prices.get(position.symbol)!;
        position.unrealizedPnl = (position.currentPrice - position.entryPrice) * position.quantity;
      }
    }

    await this.redis.set(this.POSITIONS_KEY, JSON.stringify(positions));
    return positions;
  }

  /**
   * Reset paper trading account
   */
  async reset(): Promise<PaperAccount> {
    return this.initialize();
  }

  private async saveTrade(trade: PaperTrade): Promise<void> {
    await this.redis.lpush(this.TRADES_KEY, JSON.stringify(trade));
    await this.redis.ltrim(this.TRADES_KEY, 0, 999); // Keep last 1000 trades
  }

  private async saveAccount(account: PaperAccount): Promise<void> {
    await this.redis.set(this.ACCOUNT_KEY, JSON.stringify(account));
  }
}
